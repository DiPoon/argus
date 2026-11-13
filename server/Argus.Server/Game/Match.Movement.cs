namespace Argus.Server.Game;

public sealed partial class Match
{
    // mover가 null이면 플레이어다. 플레이어끼리는 통과하고 나머지 몸 충돌은 막는다.
    private bool CanOccupy(FixedVector position, Fixed radius, Enemy? mover)
    {
        if (!Map.CanStand(position, radius))
        {
            return false;
        }
        for (int i = 0; i < Enemies.Count; i++)
        {
            Enemy other = Enemies[i];
            if (other == mover || other.Hp <= 0)
            {
                continue;
            }
            Fixed minimum = radius + other.Definition.Radius;
            if (FixedVector.DistanceSquared(position, other.Position) < minimum * minimum - TouchTolerance)
            {
                return false;
            }
        }
        if (mover != null)
        {
            for (int i = 0; i < Players.Count; i++)
            {
                Player player = Players[i];
                Fixed minimum = radius + Rules.PlayerRadius;
                if (player.State == "alive" &&
                    FixedVector.DistanceSquared(position, player.Position) < minimum * minimum - TouchTolerance)
                {
                    return false;
                }
            }
        }
        return true;
    }

    // delta만큼 움직이되 4단위보다 길면 나눠서 조금씩 움직인다. 한 번에 멀리 움직이면 얇은 벽이나 다른 몸을 뛰어넘을 수 있다.
    // 조각마다 가로와 세로를 따로 움직여, 막힌 쪽만 멈추고 벽을 따라 미끄러지게 한다.
    private FixedVector MoveBody(FixedVector from, FixedVector delta, Fixed radius, Enemy? mover)
    {
        // 걸음 수는 길이를 4로 나눈 몫을 올린 값이다.
        int steps = Math.Max(1, delta.Length().CeilingDivide(4));
        // i번째 걸음까지 나아갈 양(delta × i / 걸음 수)에서 앞 걸음까지의 양을 빼 이번 걸음을 정한다.
        // delta / 걸음 수를 걸음마다 쓰면 성분마다 반올림한 오차가 걸음 수만큼 쌓이지만, 이렇게 하면 걸음을 다 더해 정확히 delta가 된다.
        // 막혀서 못 간 걸음의 몫은 다음 걸음으로 넘기지 않는다.
        FixedVector planned = FixedVector.Zero;
        for (int i = 1; i <= steps; i++)
        {
            FixedVector reach = delta * i / steps;
            FixedVector step = reach - planned;
            planned = reach;
            FixedVector next = new FixedVector(from.X + step.X, from.Y);
            if (CanOccupy(next, radius, mover))
            {
                from = next;
            }
            next = new FixedVector(from.X, from.Y + step.Y);
            if (CanOccupy(next, radius, mover))
            {
                from = next;
            }
        }
        return from;
    }

    // 적의 몸을 delta만큼 움직인다. 먼저 MoveBody로 가로와 세로를 따로 움직여 본다. 벽 면에 막히면 그 면을 따라 미끄러진다.
    // 그것으로 다 가지 못했으면 막은 것을 끼고 도는 길(Slide)도 구해, 가려던 쪽으로 더 나아간 것을 쓴다.
    // 가로와 세로를 따로 움직이는 것만으로는 벽 모서리와 다른 몸에 함께 막혔을 때 빠져나오지 못한다. 모서리에 걸린 적은
    // 가로로 조금 비켜야 모서리를 돌 수 있는데, 그 가로를 옆에 붙은 적이 막고 세로는 모서리가 막는다. 비스듬히 모서리를
    // 끼고 도는 길은 열려 있어도 가로와 세로 어느 하나로는 가지 못한다.
    private FixedVector MoveEnemy(Enemy enemy, FixedVector delta, FixedVector toward)
    {
        FixedVector from = enemy.Position;
        FixedVector stepped = MoveBody(from, delta, enemy.Definition.Radius, enemy);
        if (stepped == from + delta)
        {
            return stepped;
        }
        FixedVector slid = Slide(enemy, delta, toward);
        // 가로와 세로로는 조금도 가지 못했으면 끼고 도는 길로 간다. 다른 적의 몸에 딱 정면으로 막혀 옆으로 도는 걸음은
        // 가려던 쪽으로는 조금도 나아가지 않으므로, 나아간 양만 견주면 고르지 못한다.
        if (stepped == from)
        {
            return slid;
        }
        // 조금이라도 갔으면, 가려던 쪽으로 더 나아간 것을 쓴다.
        Fixed steppedGain = (stepped - from).Dot(delta);
        Fixed slidGain = (slid - from).Dot(delta);
        if (slidGain > steppedGain)
        {
            return slid;
        }
        return stepped;
    }

    // 막은 것을 끼고 도는 이동이다. 가려던 자리를 막은 것 가운데 가장 깊이 겹치는 것을 골라, 그것 쪽으로 파고드는 성분을 빼고
    // 남은 방향(그것의 겉을 따라가는 방향)으로 간다. 그 길도 다른 것이 막으면 움직이지 않는다.
    private FixedVector Slide(Enemy enemy, FixedVector delta, FixedVector toward)
    {
        FixedVector from = enemy.Position;
        Fixed radius = enemy.Definition.Radius;
        // 설 수 있는 자리인지는 늘 CanOccupy로 정한다. Blocker는 막은 것의 방향을 알아내는 데만 쓴다.
        // 가로와 세로를 따로 움직여서는 못 갔어도, 두 몸 사이를 비스듬히 지나는 자리가 비어 있으면 그대로 간다.
        if (CanOccupy(from + delta, radius, enemy))
        {
            return from + delta;
        }
        FixedVector normal;
        bool body;
        if (!Blocker(enemy, from + delta, out normal, out body))
        {
            return from;
        }
        // 막은 것에서 멀어지는 쪽인데도 막혔다면(방향을 정할 수 없었거나 반올림) 끼고 돌 방향이 없다.
        Fixed into = delta.Dot(normal);
        if (into >= Fixed.Zero)
        {
            return from;
        }
        FixedVector along = delta - normal * into;
        // 다른 적의 몸을 거의 정면으로 밀고 있으면 겉을 따라가는 성분이 거의 없어 그 뒤에 그대로 선다. 한 칸 틈에서 줄지어
        // 나온 적들이 대원과 한 줄에 서면, 맨 앞의 적 뒤에 모두 멈춰 대원을 둘러싸지 못한다. 그때는 옆으로 돌아간다.
        // 벽과 대원의 몸은 돌아가지 않는다. 대원에게 닿은 적은 다 온 것이라 대원 둘레를 돌 까닭이 없다.
        // 도는 쪽은 쫓는 대원 쪽(toward)에서 보아 이미 치우쳐 있는 쪽이고, 딱 정면이면 늘 같은 쪽이다.
        // 가려는 방향이나 이번 틱의 이동(delta)으로 고르지 않는다. 가려는 방향은 직진과 흐름장 사이를 오갈 수 있고(몸 통과 판단이
        // 한 걸음 차이로 갈리는 자리), 이동에는 길을 내주는 방향이 섞여 틱마다 조금씩 달라진다. 그런 것으로 고르면 도는 쪽이
        // 틱마다 뒤집혀, 앞줄 뒤에서 기다리는 적이 제자리에서 떤다.
        // 옆으로 도는 걸음은 제 빠르기다. 절반 빠르기로도 재 봤는데 제자리에서 떠는 틱이 더 많았다(2026-11-14). 장면 하나로 가를 수는
        // 없어 검사로 묶지 않았다.
        if (body && along.LengthSquared() * 4 < delta.LengthSquared())
        {
            FixedVector side = new FixedVector(-normal.Y, normal.X);
            if (side.Dot(toward) < Fixed.Zero)
            {
                side = -side;
            }
            along = side * delta.Length();
        }
        if (along.LengthSquared() < TinyLengthSquared)
        {
            return from;
        }
        if (CanOccupy(from + along, radius, enemy))
        {
            return from + along;
        }
        return from;
    }

    // position으로 가려는 적을 막는 것을 찾는다. 막는 것이 없으면 false다. 여럿이면 가장 깊이 겹치는 것을 고른다.
    // normal은 그것에서 적의 지금 자리 쪽을 향하는 길이 1의 방향이다. 방향을 정할 수 없으면 0 벡터다.
    // body는 그것이 다른 적의 몸인지다(벽이나 대원의 몸이면 false).
    private bool Blocker(Enemy enemy, FixedVector position, out FixedVector normal, out bool body)
    {
        FixedVector from = enemy.Position;
        Fixed radius = enemy.Definition.Radius;
        FixedVector away;
        Fixed depth;
        bool blocked = Map.DeepestWall(position, radius, from, out away, out depth);
        body = false;
        for (int i = 0; i < Enemies.Count; i++)
        {
            Enemy other = Enemies[i];
            if (other == enemy || other.Hp <= 0)
            {
                continue;
            }
            Fixed minimum = radius + other.Definition.Radius;
            Fixed distanceSquared = FixedVector.DistanceSquared(position, other.Position);
            if (distanceSquared >= minimum * minimum - TouchTolerance)
            {
                continue;
            }
            Fixed overlap = minimum - Fixed.Sqrt(distanceSquared);
            if (blocked && overlap <= depth)
            {
                continue;
            }
            blocked = true;
            body = true;
            depth = overlap;
            away = from - other.Position;
        }
        for (int i = 0; i < Players.Count; i++)
        {
            Player player = Players[i];
            if (player.State != "alive")
            {
                continue;
            }
            Fixed minimum = radius + Rules.PlayerRadius;
            Fixed distanceSquared = FixedVector.DistanceSquared(position, player.Position);
            if (distanceSquared >= minimum * minimum - TouchTolerance)
            {
                continue;
            }
            Fixed overlap = minimum - Fixed.Sqrt(distanceSquared);
            if (blocked && overlap <= depth)
            {
                continue;
            }
            blocked = true;
            body = false;
            depth = overlap;
            away = from - player.Position;
        }
        normal = FixedVector.Zero;
        if (blocked && away.LengthSquared() >= TinyLengthSquared)
        {
            normal = away.Normalize();
        }
        return blocked;
    }

    // 적 id는 무작위로 정한다. 효과·행동과 같은 순번을 쓰면 보이는 id 사이의 빈 번호로
    // 안개 속에서 생성된 적의 수를 셀 수 있다. 살아 있는 적끼리는 겹치지 않게 한다.
    // 방의 시드에서 뽑으므로 같은 시드면 같은 id가 나온다. 출력으로 다음 값을 알 수 없는 생성기라
    // 보이는 적 id로 다음 생성이나 적의 행동 선택을 미리 알아낼 수 없다.
    private int NewEnemyId()
    {
        while (true)
        {
            int id = _random.NextInt(1, int.MaxValue);
            bool taken = false;
            for (int i = 0; i < Enemies.Count; i++)
            {
                if (Enemies[i].Id == id)
                {
                    taken = true;
                    break;
                }
            }
            if (!taken)
            {
                return id;
            }
        }
    }

    // 처음 배치는 정해진 자료이므로 자리가 막혀 있으면 결함이다. AddEnemy처럼 조용히 빼지 않고 예외를 낸다.
    // 이 시점에는 대원도 숨은 정보도 없으므로 실패를 알려도 안개 속을 엿보는 수단이 되지 않는다.
    // 규칙이 적을 두지 않게 한 경우(검사의 MaxEnemies = 0 등)는 결함이 아니므로 그냥 넘어간다.
    private void PlaceInitialEnemy(FixedVector spot, EnemyDefinition definition)
    {
        if (Enemies.Count >= Rules.MaxEnemies)
        {
            return;
        }
        if (!AddEnemy(spot, definition))
        {
            throw new InvalidOperationException($"처음 배치 자리 {spot}에 {definition.Id}을 둘 수 없습니다. 벽이나 다른 적과 겹칩니다.");
        }
    }

    // 자리가 비어 있으면 적을 추가하고 true를 돌려준다.
    private bool AddEnemy(FixedVector position, EnemyDefinition definition)
    {
        if (Enemies.Count >= Rules.MaxEnemies)
        {
            return false;
        }
        Enemy candidate = new Enemy(NewEnemyId(), position, definition);
        if (!CanOccupy(position, definition.Radius, candidate))
        {
            return false;
        }
        candidate.NextActionTick = Tick + Rules.ToTicks(1);
        Enemies.Add(candidate);
        return true;
    }

    private void SpawnEnemy()
    {
        EnemyDefinition definition = EnemyDefinition.Grunt;
        // 시간이 지나도 첫 작전에는 2티어 적이 섞이지 않도록 추가 생성에도 같은 규칙을 적용한다.
        if (Rules.AllowEliteEnemies)
        {
            double roll = _random.NextDouble();
            if (roll < 0.15)
            {
                definition = EnemyDefinition.Breaker;
            }
            else if (roll < 0.25 && ElapsedTicks > Rules.ToTicks(45))
            {
                definition = EnemyDefinition.Warden;
            }
        }
        // 분대가 보고 있거나 벽·몸에 막힌 자리면 각도를 다시 뽑는다. 끝까지 못 찾으면 이번 회차는 넘긴다.
        for (int attempt = 0; attempt < 12; attempt++)
        {
            // 배치가 정한 증원 타원(Layout.Reinforcements) 위의 한 점이다.
            Angle angle = Angle.FromUnits(_random.NextInt(0, Angle.UnitsPerTurn));
            FixedVector direction = angle.Direction();
            SpawnRing ring = Layout.Reinforcements;
            FixedVector position = new FixedVector(ring.Center.X + direction.X * ring.RadiusX, ring.Center.Y + direction.Y * ring.RadiusY);
            if (Visible(position))
            {
                continue;
            }
            if (AddEnemy(position, definition))
            {
                return;
            }
        }
    }

    private void BuildFlow()
    {
        Array.Fill(_flow, int.MaxValue);
        Queue<int> queue = new Queue<int>();
        for (int i = 0; i < Players.Count; i++)
        {
            if (Players[i].State != "alive")
            {
                continue;
            }
            FixedVector position = Players[i].Position;
            int index = position.Y.FloorDivide(BattleMap.Cell) * Map.Columns + position.X.FloorDivide(BattleMap.Cell);
            if (index >= 0 && index < _flow.Length && _flow[index] != 0)
            {
                _flow[index] = 0;
                queue.Enqueue(index);
            }
        }
        while (queue.Count > 0)
        {
            int index = queue.Dequeue();
            int x = index % Map.Columns;
            int y = index / Map.Columns;
            for (int direction = 0; direction < 4; direction++)
            {
                int nx = x + NeighborX[direction];
                int ny = y + NeighborY[direction];
                if (Map.Solid(nx, ny))
                {
                    continue;
                }
                int next = ny * Map.Columns + nx;
                if (_flow[next] <= _flow[index] + 1)
                {
                    continue;
                }
                _flow[next] = _flow[index] + 1;
                queue.Enqueue(next);
            }
        }
    }

    // 흐름장에서 다음으로 갈 방향을 찾는다. 자기 칸보다 비용이 낮은 이웃이 없으면(대원이 있는 출발점 칸)
    // 0 벡터를 돌려주어 부르는 쪽이 대원에게 직진하게 한다. 이웃 칸(비용 1)으로 향하면 오히려 멀어진다.
    public FixedVector FlowHeading(FixedVector position)
    {
        int x = position.X.FloorDivide(BattleMap.Cell);
        int y = position.Y.FloorDivide(BattleMap.Cell);
        int best = int.MaxValue;
        if (!Map.Solid(x, y))
        {
            best = _flow[y * Map.Columns + x];
        }
        FixedVector heading = FixedVector.Zero;
        for (int direction = 0; direction < 4; direction++)
        {
            int nx = x + NeighborX[direction];
            int ny = y + NeighborY[direction];
            if (Map.Solid(nx, ny))
            {
                continue;
            }
            int cost = _flow[ny * Map.Columns + nx];
            if (cost < best)
            {
                best = cost;
                // 이웃 칸의 가운데를 향한다.
                FixedVector center = FixedVector.FromInt(nx * BattleMap.Cell + BattleMap.Cell / 2, ny * BattleMap.Cell + BattleMap.Cell / 2);
                heading = center - position;
            }
        }
        return heading;
    }

    // 몸이 직선으로 지나갈 수 있는지 본다. 몸 중심선은 호출 전에 사선으로 이미 확인했고,
    // 여기서는 몸 양옆 가장자리를 지나는 두 선을 본다. 세 선의 간격(반지름 이하)이 벽 타일(48)보다 좁아서
    // 그 사이로 벽이 빠져나가지 못한다.
    private bool BodyCanPass(Enemy enemy, FixedVector target)
    {
        FixedVector direction = target - enemy.Position;
        if (direction.LengthSquared() < TinyLengthSquared)
        {
            return true;
        }
        // 옆선 간격을 반지름보다 조금(0.5) 줄인다. 벽에 딱 붙은 적은 옆선이 벽 면 위에서 시작해 거리 0에서 막혔다고 나오기 때문이다.
        FixedVector side = new FixedVector(-direction.Y, direction.X);
        FixedVector normal = side.Normalize() * (enemy.Definition.Radius - Fixed.One / 2);
        if (!Map.LineOfSight(enemy.Position + normal, target + normal))
        {
            return false;
        }
        return Map.LineOfSight(enemy.Position - normal, target - normal);
    }

    // 그 자리에서 대원까지 가는 길의 칸 수다(흐름장). 벽 안이거나 길이 없으면 가장 큰 수다.
    private int FlowCost(FixedVector position)
    {
        int x = position.X.FloorDivide(BattleMap.Cell);
        int y = position.Y.FloorDivide(BattleMap.Cell);
        if (Map.Solid(x, y))
        {
            return int.MaxValue;
        }
        return _flow[y * Map.Columns + x];
    }

    // 예고하는 적이 행동을 시작할 때 노린 대원 쪽으로 돈다. 도는 빠르기에 한도는 없다(docs/combat.md 시험 설정).
    // 노린 대원이 쓰러졌거나 나갔으면 다른 대원으로 바꾸지 않고 마지막 방향을 유지한다.
    // 처음 노린 대원만 보므로, 다른 대원을 노리는 적은 동료가 옆에서 칠 수 있다.
    private void TurnToTarget(Enemy enemy, EnemyAction action)
    {
        // 검사가 직접 만든 행동처럼 노린 대원이 없으면 null이라 돌지 않는다.
        Player? target = FindPlayer(action.TargetId);
        if (target == null || target.State != "alive")
        {
            return;
        }
        FixedVector offset = target.Position - enemy.Position;
        // 몸이 겹칠 만큼 가까우면 방향을 정할 수 없으므로 그대로 둔다. 몸 충돌 때문에 정상 진행에서는 일어나지 않는다.
        if (offset.LengthSquared() < TinyLengthSquared)
        {
            return;
        }
        action.Turn(Angle.Of(offset));
    }

    // 적을 한 틱 진행한다. 세 단계다.
    // 1. 행동(ActEnemies): 끝난 행동을 치우고, 공격 거리 안이면 새 행동을 고르고, 아니면 가려는 방향을 정한다. 적 목록 차례대로다.
    // 2. 계획(PlanMoves): 움직일 적의 이번 틱 이동을 앞선 적부터 정한다. 뒤선 적은 가까이에서 움직이는 앞선 적에게 길을 내준다.
    // 3. 이동(MoveEnemies): 정한 대로 몸을 움직인다. 막히면 막은 것을 끼고 돈다(MoveEnemy).
    private void UpdateEnemies()
    {
        ActEnemies();
        PlanMoves();
        MoveEnemies();
    }

    // 적마다 행동을 처리하고, 움직일 적은 쫓을 대원과 가려는 방향을 정해 이동 계획(_moving)에 넣는다.
    // 새 행동을 고를 때 난수를 뽑으므로 적 목록 차례대로 한다. 가려는 방향은 그 적의 자리와 대원, 맵에만 달려 있다.
    private void ActEnemies()
    {
        _moving.Clear();
        for (int i = 0; i < Enemies.Count; i++)
        {
            Enemy enemy = Enemies[i];
            if (enemy.Hp <= 0)
            {
                continue;
            }
            if (enemy.Action != null)
            {
                if (enemy.Action.EndsTick > Tick)
                {
                    // 예고하는 동안에는 노린 대원 쪽으로 돈다. 공격 창이 열리면 직전 틱의 방향을 유지한다.
                    // 공격은 창이 열리는 첫 틱에 판정되므로 노린 대원은 걸어서 피할 수 없다(한 틱에 6을 걷고, 공격의 가운데 줄에서
                    // 26~37 안이면 맞는다). 의도한 것이다. 피하기는 앞으로 추가될 대시 같은 기술이 맡는다(2026-11-08 사용자 결정).
                    if (Tick < enemy.Action.ContactTick)
                    {
                        TurnToTarget(enemy, enemy.Action);
                    }
                    continue;
                }
                enemy.Action = null;
            }
            // 가장 가까운 살아 있는 대원을 쫓는다. 거리가 같으면 먼저 참가한 대원이다.
            Player? target = null;
            Fixed closest = Fixed.Zero;
            for (int j = 0; j < Players.Count; j++)
            {
                Player player = Players[j];
                if (player.State != "alive")
                {
                    continue;
                }
                Fixed distance = FixedVector.DistanceSquared(player.Position, enemy.Position);
                if (target == null || distance < closest)
                {
                    closest = distance;
                    target = player;
                }
            }
            if (target == null)
            {
                continue;
            }
            FixedVector direct = target.Position - enemy.Position;
            bool sight = Map.LineOfSight(enemy.Position, target.Position);
            if (Tick >= enemy.NextActionTick && closest < Fixed.FromInt(EngageDistance * EngageDistance) && sight)
            {
                int index = _random.NextInt(0, enemy.Definition.Skills.Length);
                EnemySkill skill = enemy.Definition.Skills[index];
                _nextId++;
                enemy.Action = new EnemyAction(_nextId, skill, Angle.Of(direct), Tick, Rules.EnemyWindupMultiplier, target.Id);
                // 회복이 끝난 틱에서 0.25초(8틱) 쉰 뒤 다음 행동을 고른다.
                enemy.NextActionTick = enemy.Action.EndsTick + Rules.ToTicks(0.25);
                continue;
            }
            // 조향: 몸이 직선으로 지나갈 수 있으면 직진하고, 사선이 가려졌거나 몸이 모서리에 걸리면 흐름장 경로를 따른다.
            FixedVector heading = direct;
            if (!sight || !BodyCanPass(enemy, target.Position))
            {
                FixedVector flow = FlowHeading(enemy.Position);
                if (flow.LengthSquared() > TinyLengthSquared)
                {
                    heading = flow;
                }
            }
            if (heading.LengthSquared() < TinyLengthSquared)
            {
                continue;
            }
            EnemyPlan plan = new EnemyPlan(enemy, heading.Normalize(), direct, FlowCost(enemy.Position), closest);
            Enlist(plan);
        }
    }

    // 이동 계획을 앞선 차례의 제자리에 끼워 넣는다. 적이 많아야 수십이라 뒤에서부터 자리를 찾는다.
    private void Enlist(EnemyPlan plan)
    {
        int at = _moving.Count;
        while (at > 0 && Ahead(plan, _moving[at - 1]))
        {
            at--;
        }
        _moving.Insert(at, plan);
    }

    // first가 second보다 앞선 적인지다. 대원까지 가는 길이 더 짧은 적이 앞선다. 길의 칸 수가 같으면 쫓는 대원에게 더 가까운 적,
    // 그것도 같으면 id가 작은 적이다. 어느 두 적 사이에서도 한쪽이 앞서므로, 서로 길을 내주려다 둘 다 멈추는 일이 없다.
    private bool Ahead(EnemyPlan first, EnemyPlan second)
    {
        if (first.Cost != second.Cost)
        {
            return first.Cost < second.Cost;
        }
        if (first.Closest != second.Closest)
        {
            return first.Closest < second.Closest;
        }
        return first.Enemy.Id < second.Enemy.Id;
    }

    // 앞선 적부터 이번 틱의 이동을 정한다. 뒤선 적의 이동은 앞선 적이 움직이는지 기다리는지에 달려 있으므로 앞선 적부터 정해야 한다.
    private void PlanMoves()
    {
        for (int rank = 0; rank < _moving.Count; rank++)
        {
            EnemyPlan plan = _moving[rank];
            Enemy enemy = plan.Enemy;
            plan.Step = Steer(plan, rank);
            // 더 갈 수 없어 기다리는 적에게는 뒤선 적이 길을 내주지 않는다(Yield). 이번 틱에 서 있는 적과, 다음 걸음이 막힌 적이다.
            // 서 있는 적을 빼도 행동 없는 장면은 같지만, 적이 행동하는 장면에서 제자리에서 떠는 틱이 는다(2026-11-14에 잰 것.
            // 장면 하나로 가를 수는 없어 검사로 묶지 않았다).
            plan.Waiting = plan.Step.IsZero() || Stuck(enemy, enemy.Position + plan.Step, rank);
        }
    }

    // position으로 가려는 적이 더 갈 수 없어 기다리게 되는지다. 그 자리의 몸이 아래 셋 가운데 하나와 겹치면 그렇다.
    // - 살아 있는 대원의 몸: 대원에게 다 온 적이다.
    // - 행동 중인 적의 몸: 예고하고 공격하는 적은 그 자리에 서 있다. 그 뒤에 선 적이다.
    // - 기다리는 앞선 적의 몸: rank는 이 적의 앞선 차례다. 앞선 적들이 기다리는지는 이미 정해져 있으므로,
    //   다 온 적 뒤에 선 적, 그 뒤에 선 적으로 차례로 이어진다.
    private bool Stuck(Enemy enemy, FixedVector position, int rank)
    {
        for (int i = 0; i < Players.Count; i++)
        {
            Player player = Players[i];
            if (player.State != "alive")
            {
                continue;
            }
            Fixed minimum = enemy.Definition.Radius + Rules.PlayerRadius;
            if (FixedVector.DistanceSquared(position, player.Position) < minimum * minimum - TouchTolerance)
            {
                return true;
            }
        }
        for (int i = 0; i < Enemies.Count; i++)
        {
            Enemy acting = Enemies[i];
            if (acting == enemy || acting.Hp <= 0 || acting.Action == null)
            {
                continue;
            }
            Fixed minimum = enemy.Definition.Radius + acting.Definition.Radius;
            if (FixedVector.DistanceSquared(position, acting.Position) < minimum * minimum - TouchTolerance)
            {
                return true;
            }
        }
        for (int ahead = 0; ahead < rank; ahead++)
        {
            EnemyPlan other = _moving[ahead];
            if (!other.Waiting)
            {
                continue;
            }
            Fixed minimum = enemy.Definition.Radius + other.Enemy.Definition.Radius;
            if (FixedVector.DistanceSquared(position, other.Enemy.Position) < minimum * minimum - TouchTolerance)
            {
                return true;
            }
        }
        return false;
    }

    // 뒤선 적부터 움직인다. 길을 내주는 적이 먼저 자리를 비워야 앞선 적이 같은 틱에 그 자리로 간다.
    // 차례를 뒤집어(앞선 적부터) 재 보면 멈춤과 도착 수는 같고, 적이 행동하는 장면에서 제자리에서 떠는 틱이 조금 는다(2026-11-14).
    // 장면 하나로 가를 수는 없어 검사로 묶지 않았다.
    private void MoveEnemies()
    {
        for (int rank = _moving.Count - 1; rank >= 0; rank--)
        {
            EnemyPlan plan = _moving[rank];
            if (plan.Step.IsZero())
            {
                continue;
            }
            plan.Enemy.Position = MoveEnemy(plan.Enemy, plan.Step, plan.Toward);
        }
    }

    // 가려는 방향(길이 1)에 앞선 적에게 길을 내주는 방향을 더해 이번 틱의 이동을 구한다. 둘이 맞서 방향이 없어지면 0 벡터다.
    // rank는 이 적의 앞선 차례(_moving 안의 자리)다.
    private FixedVector Steer(EnemyPlan plan, int rank)
    {
        // 움직이는 앞선 적이 가까울수록 제 갈 길을 덜 가고 그 적에게서 멀어진다. 몸이 닿았으면 제 갈 길을 멈추고 비켜나기만 한다.
        Fixed strongest;
        FixedVector push = Yield(plan, rank, out strongest);
        FixedVector steer = plan.Heading * (Fixed.One - strongest) + push;
        // 두 방향이 거의 맞서 합이 짧으면(1/4 미만) 그 틱에는 서 있는다. 그런 때 제 빠르기로 움직이면, 비켜 줬다가 다음 틱에
        // 다시 다가가기를 되풀이하며 제자리에서 떤다. 움직이는 앞선 적을 바로 뒤에서 따라가는 적이 그렇다.
        if (steer.LengthSquared() < StillSteerSquared)
        {
            return FixedVector.Zero;
        }
        return steer.Normalize() * plan.Enemy.Definition.StepPerTick;
    }

    // 가까이에서 움직이는 앞선 적에게 비켜 주는 방향을 구한다. 몸이 닿기 조금 전(YieldMargin)부터, 가까울수록 세게 그 적에게서
    // 멀어진다. strongest는 그 가운데 가장 센 세기(0~1)다. 부르는 쪽이 그만큼 제 갈 길을 덜 간다.
    // - 한쪽만 비켜 준다. 서로 똑같이 밀어내면 한 칸 틈 앞에서 두 적이 마주 버티다 함께 멈춘다.
    // - 더 갈 수 없어 기다리는 적에게는 비켜 주지 않는다(EnemyPlan.Waiting, Stuck). 대원에게 다 온 적에게 비켜 주면 대원 둘레의
    //   적들이 서로 밀려나 자리를 잡지 못하고 계속 움직인다. 그 뒤에 선 적이나 행동 중인 적 뒤에 선 적에게 비켜 주면, 그 적들
    //   사이로 들어서던 적이 한 틱은 다가가고 다음 틱은 물러나기를 되풀이한다.
    // - 비켜 주려고 물러나는 적도 움직이는 적이다. 그 뒤에 붙은 적이 또 비켜 주므로, 길을 내주는 일이 뒤로 이어진다.
    private FixedVector Yield(EnemyPlan plan, int rank, out Fixed strongest)
    {
        Enemy enemy = plan.Enemy;
        FixedVector push = FixedVector.Zero;
        strongest = Fixed.Zero;
        // 나보다 앞선 적만 본다. 그 적들의 이동은 이미 정해져 있다.
        for (int ahead = 0; ahead < rank; ahead++)
        {
            EnemyPlan other = _moving[ahead];
            if (other.Waiting)
            {
                continue;
            }
            FixedVector away = enemy.Position - other.Enemy.Position;
            Fixed contact = enemy.Definition.Radius + other.Enemy.Definition.Radius;
            Fixed reach = contact + YieldMargin;
            // 거리의 제곱으로 먼저 거른다. 대부분의 적은 멀리 있다.
            if (away.LengthSquared() >= reach * reach)
            {
                continue;
            }
            Fixed distance = away.Length();
            // 아주 가까우면 길이의 반올림 오차 때문에 멀어지는 방향의 길이가 1에서 벗어나므로 넘어간다(YieldMinimum).
            if (distance >= reach || distance < YieldMinimum)
            {
                continue;
            }
            // 세기는 닿기 직전 거리(reach)에서 0, 몸이 닿았을 때 1이다.
            Fixed strength = Fixed.Min(Fixed.One, (reach - distance) / YieldMargin);
            push += away / distance * strength;
            strongest = Fixed.Max(strongest, strength);
        }
        return push;
    }
}
