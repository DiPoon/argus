namespace Argus.Server.Game;

public sealed partial class Match
{
    // 적의 장판 하나에 대한 대원의 대응이다. 장판 안에서 두른 기운이거나, 기운을 두른 그 적에게 닿은 대원의 장판이다.
    private sealed class Response
    {
        public Player Player { get; }
        public PlayerAction Action { get; }
        // 대원의 장판이 적에게 닿은 대응이면 true, 대원의 기운이면 false다.
        public bool Initiates { get; }

        public Response(Player player, PlayerAction action, bool initiates)
        {
            Player = player;
            Action = action;
            Initiates = initiates;
        }
    }

    // 같은 틱의 판정은 모두 그 틱이 시작할 때의 대원 상태로 한다(2026-11-04 합의). 적은 목록 순서대로 하나씩 판정하므로,
    // 앞의 판정이 대원의 기술을 끝내거나 대원을 쓰러뜨리면 뒤의 판정이 그 결과를 읽어 같은 장면이 적 목록 순서에 따라 다르게 끝난다.
    // 그래서 판정 도중에는 기술이 끊길 대원(_interrupted)과 완벽 대응을 내어 끝날 기술(_countered)만 적어 두고, 쓰러짐도 미룬다.
    // 모두 이 틱의 전투가 끝난 뒤 적용한다(ApplyCombatResults).
    // 대원이 받는 피해는 더하기라 순서와 관계없으므로 바로 깎는다. 적이 받는 피해도 그 적의 판정만 읽으므로 바로 준다.
    private readonly List<Player> _interrupted = new List<Player>();
    private readonly List<Response> _countered = new List<Response>();

    private void ResolveCombat()
    {
        // 앞 틱에서 예외로 전투가 중간에 멈췄다면 적어 둔 것이 남아 있을 수 있다. 이 틱의 판정만 적용하도록 비우고 시작한다.
        _interrupted.Clear();
        _countered.Clear();
        ChooseGrabTargets();
        for (int i = 0; i < Enemies.Count; i++)
        {
            Enemy enemy = Enemies[i];
            if (enemy.Hp <= 0)
            {
                continue;
            }
            ResolveEnemy(enemy);
        }
        ResolveStructures();
        ApplyCombatResults();
    }

    // 이 틱의 판정이 다 끝난 뒤 적용한다. 완벽 대응을 낸 기술은 장판 없이 거기서 끝나고, 진 대원의 기술은 끊긴다.
    // 끝나거나 끊긴 기술은 목록에서 바로 빠지므로, 대원은 다음 틱부터 다음 기술을 쓸 수 있다(2026-11-11 합의).
    // 그 뒤 체력이 다한 대원을 쓰러뜨린다.
    private void ApplyCombatResults()
    {
        // 끊긴 대원의 기술을 먼저 표시하고 비운다. 같은 틱에 한 장판은 이기고 다른 장판에는 진 기술은 두 표시가 모두 남는다.
        for (int i = 0; i < _interrupted.Count; i++)
        {
            Player player = _interrupted[i];
            for (int j = 0; j < player.Actions.Count; j++)
            {
                player.Actions[j].Cancelled = true;
            }
            player.Actions.Clear();
        }
        _interrupted.Clear();
        for (int i = 0; i < _countered.Count; i++)
        {
            Response response = _countered[i];
            response.Action.Countered = true;
            response.Player.Actions.Remove(response.Action);
        }
        _countered.Clear();
        for (int i = 0; i < Players.Count; i++)
        {
            Player player = Players[i];
            if (player.State == "alive" && player.Hp <= 0)
            {
                Fall(player);
            }
        }
    }

    // 한 명만 판정하는 기술(잡기)이 이 틱에 판정할 적을 고른다. 대상을 바꾸는 곳은 여기 한 곳이고, 판정(ResolveEnemy)은
    // 고른 대상을 읽기만 한다. 판정 도중에 대상을 정하면 적 목록의 순서가 대상을 정한다.
    private void ChooseGrabTargets()
    {
        for (int i = 0; i < Players.Count; i++)
        {
            Player player = Players[i];
            if (player.State != "alive")
            {
                continue;
            }
            for (int j = 0; j < player.Actions.Count; j++)
            {
                PlayerAction action = player.Actions[j];
                if (!action.Skill.SingleTarget || action.TargetLocked)
                {
                    continue;
                }
                // 판정을 받았으면 그 대상으로 정한다. 대상이 처치되어도 같은 시전에서 다시 고르지 않는다.
                if (action.JudgedEnemies.Count > 0)
                {
                    action.TargetLocked = true;
                    continue;
                }
                if (action.HasAura(Tick))
                {
                    // 기운이 도는 동안에는 매 틱 다시 고른다. 받아칠 장판이 없으면 대상을 비운다.
                    action.Target = AuraTarget(player, action);
                }
                else if (action.ZoneOut(Tick))
                {
                    // 장판이 나간 틱에 범위 안에서 가장 가까운 적을 잡는다. 그때 범위에 아무도 없었으면 장판이 깔려 있는 동안
                    // 처음 들어온 적이 대상이 된다. 장판으로 고른 대상은 바꾸지 않는다.
                    action.Target = ZoneTarget(player, action);
                    if (action.Target.HasValue)
                    {
                        action.TargetLocked = true;
                    }
                }
            }
        }
    }

    // 한 명만 판정하는 기운이 받아칠 장판을 낸 적이다. 대원을 덮은 장판(예고 중인 장판 포함) 가운데 기운이 향한 쪽의 것만 본다.
    // 기운이 이기는 장판을 낸 가장 가까운 적을 고른다. 이기는 장판이 없으면 지금 실제로 닿는 장판(나간 장판)을 낸 가장 가까운 적이다.
    // 그 적과는 비기거나 진다. 이기는 장판을 먼저 보는 것은, 종류가 섞인 예고 속에서도 잡기가 받아칠 수 있는 장판을 받아치게 하려는 것이다.
    private int? AuraTarget(Player player, PlayerAction action)
    {
        Enemy? winning = null;
        Fixed winningDistance = Fixed.Zero;
        Enemy? landing = null;
        Fixed landingDistance = Fixed.Zero;
        for (int k = 0; k < Enemies.Count; k++)
        {
            Enemy enemy = Enemies[k];
            EnemyAction? attack = enemy.Action;
            if (enemy.Hp <= 0 || attack == null || !attack.ZoneJudged(Tick))
            {
                continue;
            }
            if (!Covers(enemy, attack, player) || !SkillFaces(player, action, enemy))
            {
                continue;
            }
            Fixed distance = FixedVector.DistanceSquared(player.Position, enemy.Position);
            bool wins = Affinity.Beats(action.Skill.Kind, attack.Skill.Kind);
            if (wins && Closer(enemy, distance, winning, winningDistance))
            {
                winning = enemy;
                winningDistance = distance;
            }
            bool lands = attack.ZoneOut(Tick) && !attack.HitPlayers.Contains(player.Id);
            if (lands && Closer(enemy, distance, landing, landingDistance))
            {
                landing = enemy;
                landingDistance = distance;
            }
        }
        if (winning != null)
        {
            return winning.Id;
        }
        if (landing != null)
        {
            return landing.Id;
        }
        return null;
    }

    // 한 명만 판정하는 장판이 잡을 적이다. 장판의 범위 안에서 사선이 열린 가장 가까운 적이다. 없으면 null이다.
    private int? ZoneTarget(Player player, PlayerAction action)
    {
        Enemy? nearest = null;
        Fixed closest = Fixed.Zero;
        for (int k = 0; k < Enemies.Count; k++)
        {
            Enemy enemy = Enemies[k];
            if (enemy.Hp <= 0 || !SkillReaches(player, action.Skill, enemy.Position, enemy.Definition.Radius))
            {
                continue;
            }
            Fixed distance = FixedVector.DistanceSquared(player.Position, enemy.Position);
            if (Closer(enemy, distance, nearest, closest))
            {
                nearest = enemy;
                closest = distance;
            }
        }
        if (nearest == null)
        {
            return null;
        }
        return nearest.Id;
    }

    // candidate가 지금까지 고른 best보다 가까운지 본다. 거리가 같으면 id가 작은 적이다. 적 목록의 순서에 기대지 않는다.
    private static bool Closer(Enemy candidate, Fixed distance, Enemy? best, Fixed bestDistance)
    {
        if (best == null || distance < bestDistance)
        {
            return true;
        }
        return distance == bestDistance && candidate.Id < best.Id;
    }

    // 대원의 장판이 target(반지름 radius인 몸)에 닿는지 본다. 둘레 기술은 대원 둘레의 원, 그 밖에는 조준 방향의 사각형이다.
    // 몸의 중심이 벽 반대편이면 닿지 않는다.
    private bool SkillReaches(Player player, SkillDefinition skill, FixedVector target, Fixed radius)
    {
        return SkillCovers(player, skill, target, radius) && Map.LineOfSight(player.Position, target);
    }

    // SkillReaches에서 사선을 뺀 모양만 본다.
    private bool SkillCovers(Player player, SkillDefinition skill, FixedVector target, Fixed radius)
    {
        if (skill.Around)
        {
            // 거리는 제곱끼리 비교한다.
            Fixed reach = skill.RangeFixed + radius;
            return FixedVector.DistanceSquared(player.Position, target) <= reach * reach;
        }
        return InShape(player.Position, player.AimDirection, skill.RangeFixed, skill.HalfWidthFixed, target, radius);
    }

    // forward 방향의 사각형 범위에 target의 몸이 닿고, 몸의 중심 사이가 벽에 가리지 않는지 본다.
    private bool InReach(FixedVector origin, FixedVector forward, Fixed range, Fixed halfWidth, FixedVector target, Fixed radius)
    {
        // 몸의 중심이 벽 반대편이면 좁은 근접 공격도 통과하지 못한다.
        return InShape(origin, forward, range, halfWidth, target, radius) && Map.LineOfSight(origin, target);
    }

    // forward는 조준 방향의 길이 1 벡터다(Player.AimDirection, EnemyAction.Direction). 판정마다 삼각함수를 다시 구하지 않는다.
    // 대상까지의 벡터를 조준 방향의 앞뒤 거리(내적)와 옆 거리(외적의 크기)로 나눠, 사거리와 반폭(대상의 반지름만큼 넓힌)과 비교한다.
    private static bool InShape(FixedVector origin, FixedVector forward, Fixed range, Fixed halfWidth, FixedVector target, Fixed radius)
    {
        FixedVector offset = target - origin;
        Fixed along = offset.Dot(forward);
        Fixed side = Fixed.Abs(offset.Cross(forward));
        return along >= Fixed.Zero && along <= range + radius && side <= halfWidth + radius;
    }

    // origin에서 aim 방향을 기준으로 target이 전방 120°(방어 각도) 안에 있는지 본다.
    // 대원의 기운이 향한 쪽, 적 방어의 반격 차단, 측면 공격 판정이 모두 이 계산을 쓴다.
    // 사잇각을 구하지 않고 내적으로 비교한다. 사잇각이 반각 이하 ⟺ offset·forward ≥ |offset| × cos(반각)이다.
    // 반각이 반 바퀴 이상이면 내적을 보지 않고 모든 방향을 막는다. 방향 벡터는 1/4096 단위로 반올림해 길이가 1보다 조금 길 수 있어,
    // 코사인 -1과 내적으로 비교하면 정확히 뒤쪽(약 1° 안)을 놓친다. 반각이 60°일 때 이 오차는 0.01° 안쪽이라 판정에 드러나지 않는다.
    private bool Faces(FixedVector origin, FixedVector forward, FixedVector target)
    {
        if (!_guardsAnyDirection)
        {
            return false;
        }
        if (_guardsEveryDirection)
        {
            return true;
        }
        FixedVector offset = target - origin;
        Fixed along = offset.Dot(forward);
        return along >= offset.Length() * _guardCosine;
    }

    // 대원의 기운이 향한 쪽에 적이 있는지 본다. 둘레 기술은 모든 방향, 그 밖에는 앞 120°다.
    private bool SkillFaces(Player player, PlayerAction action, Enemy enemy)
    {
        if (action.Skill.Around)
        {
            return true;
        }
        return Faces(player.Position, player.AimDirection, enemy.Position);
    }

    // 적의 기운이 대원 쪽으로 도는지 본다. 적의 기운은 그 행동이 향한 범위 안의 대원에게만 돈다(2026-10-14 합의).
    // 타격과 잡기는 그 장판이다. 방어는 밀어치기의 장판과 방패가 향한 전방 120°를 합친다.
    // 밀어치기는 적 몸 옆까지 조금 더 닿으므로, 전방 120°만 보면 그 자리의 대원이 맞기만 하고 상성으로 대응하지 못한다.
    // 범위 밖에서 친 대원의 장판에는 상성이 없다(측면 공격).
    private bool InActionArea(Enemy enemy, EnemyAction attack, Player player)
    {
        if (Covers(enemy, attack, player))
        {
            return true;
        }
        if (attack.Skill.Kind == "block")
        {
            return Faces(enemy.Position, attack.Direction, player.Position);
        }
        return false;
    }

    // 적의 장판이 대원의 몸을 덮는지 본다. 예고 중인 장판도 같은 모양이다. 몸의 중심 사이가 벽에 가리면 덮지 않는다.
    private bool Covers(Enemy enemy, EnemyAction attack, Player player)
    {
        return InReach(enemy.Position, attack.Direction, attack.Skill.RangeFixed, attack.Skill.HalfWidthFixed, player.Position, Rules.PlayerRadius);
    }

    // 대원에게 지금 기운이 도는 기술이 있는지다.
    private bool HasAura(Player player)
    {
        for (int i = 0; i < player.Actions.Count; i++)
        {
            if (player.Actions[i].HasAura(Tick))
            {
                return true;
            }
        }
        return false;
    }

    // 적 하나에 대한 이 틱의 판정이다.
    // 1. 상성 없이 들어가는 타격을 먼저 준다. 기운이 없는 적(무행동·회복·공격 창)을 친 장판, 적의 기운이 향하지 않은 쪽에서 친
    //    장판(측면 공격), 받아치기의 반격이 그렇다. 그 피해로 적이 쓰러지면 이 틱 그 적의 공격은 무효다.
    // 2. 이 적의 장판에 대한 대응을 모은다. 장판 안에서 장판 쪽으로 두른 기운과, 기운을 두른 이 적에게 닿은 대원의 장판이다.
    //    적의 장판은 예고할 때부터 대원의 기운과 판정하고, 대원의 장판은 나간 뒤에만 적의 기운과 판정한다.
    // 3. 이기는 대응의 수가 티어 이상이면 완벽 대응이다. 적을 처치하고, 대응한 기술은 거기서 끝난다.
    // 4. 아니면 실제로 닿은 대원만 판정한다. 적의 나간 장판에 닿은 대원과, 자기 장판으로 이 적의 기운을 친 대원이다.
    //    예고 중인 장판 안에서 기운을 두르고만 있는 대원에게는 아무 일도 없다. 그 판정은 장판이 나가 닿을 때로 미룬다.
    private void ResolveEnemy(Enemy enemy)
    {
        // 이 적의 장판이다. 예고 중이면 아직 나가지 않은 장판이고 몸에 기운이 돈다. 공격 창이면 나간 장판이고 기운은 없다.
        // 행동이 없거나 회복 중이면 장판도 기운도 없다.
        EnemyAction? attack = null;
        if (enemy.Action != null && enemy.Action.ZoneJudged(Tick))
        {
            attack = enemy.Action;
        }
        bool aura = attack != null && attack.HasAura(Tick);
        List<Response> responses = new List<Response>();
        // 상성 없이 들어가는 대원의 장판이다.
        List<Response> plainHits = new List<Response>();
        // 적의 나간 장판에 닿은 대원이다.
        List<Player> threatened = new List<Player>();
        for (int i = 0; i < Players.Count; i++)
        {
            Player player = Players[i];
            if (player.State != "alive")
            {
                continue;
            }
            // 장판이 이 대원을 덮는지는 나간 장판이거나 대원에게 기운이 돌 때만 쓰인다. 그때만 사선을 따라간다.
            bool covered = false;
            if (attack != null && (!aura || HasAura(player)))
            {
                covered = Covers(enemy, attack, player);
            }
            // 이 장판과 이미 피해를 주고받은 대원에게는 다시 닿지 않는다.
            if (attack != null && covered && !aura && !attack.HitPlayers.Contains(player.Id))
            {
                threatened.Add(player);
            }
            for (int j = 0; j < player.Actions.Count; j++)
            {
                PlayerAction action = player.Actions[j];
                // 한 명만 판정하는 기술(잡기)은 ChooseGrabTargets가 고른 대상만 판정한다. 여기서는 대상을 바꾸지 않는다.
                if (action.Skill.SingleTarget && action.Target != enemy.Id)
                {
                    continue;
                }
                if (action.HasAura(Tick))
                {
                    // 기운: 이 적의 장판 안에 있고 기운이 그 적 쪽을 향하면 대응이다. 기술의 사거리와 관계없다.
                    // 이 장판에 이미 당한 대원의 기운도 대응으로 친다. 그 대원에게 장판이 다시 닿지 않을 뿐이다.
                    if (covered && !action.JudgedEnemies.Contains(enemy.Id) && SkillFaces(player, action, enemy))
                    {
                        responses.Add(new Response(player, action, false));
                    }
                    continue;
                }
                if (!action.ZoneOut(Tick))
                {
                    continue;
                }
                // 장판: 나간 장판은 닿은 적을 한 번씩 친다. 상성 없는 장판(반격)은 기운의 판정과 따로 센다.
                HashSet<int> struck = action.JudgedEnemies;
                if (action.Skill.PlainZone)
                {
                    struck = action.PlainHits;
                }
                if (struck.Contains(enemy.Id) || !SkillReaches(player, action.Skill, enemy.Position, enemy.Definition.Radius))
                {
                    continue;
                }
                // 적에게 기운이 돌고 그 기운이 이 대원 쪽으로 돌 때만 상성으로 판정한다.
                bool affinity = attack != null && aura && !action.Skill.PlainZone && InActionArea(enemy, attack, player);
                if (affinity)
                {
                    responses.Add(new Response(player, action, true));
                }
                else
                {
                    plainHits.Add(new Response(player, action, true));
                }
            }
        }

        // 1. 상성 없는 타격을 먼저 준다. 다른 대원의 타격으로 이미 쓰러진 적은 치지 않은 것으로 둔다.
        for (int i = 0; i < plainHits.Count; i++)
        {
            Response hit = plainHits[i];
            if (enemy.Hp <= 0)
            {
                break;
            }
            if (hit.Action.Skill.PlainZone)
            {
                hit.Action.PlainHits.Add(enemy.Id);
                // 상성 없는 반격도 적의 방어 기운이 향한 쪽에서는 막힌다. 이것은 RPS 승패가 아니다.
                bool guarded = attack != null && aura && attack.Skill.Kind == "block" &&
                    Faces(enemy.Position, attack.Direction, hit.Player.Position);
                if (guarded)
                {
                    Effect(enemy.Position, "guard", 0.4);
                    continue;
                }
            }
            else
            {
                hit.Action.JudgedEnemies.Add(enemy.Id);
            }
            DamageEnemy(enemy, 1, hit.Player);
        }
        if (enemy.Hp <= 0 || attack == null)
        {
            return;
        }

        // 2~3. 같은 장판에 유효한 대응을 먼저 모두 센다. 플레이어 순서 때문에 C가 먼저 다치면 안 된다.
        List<Response> counters = new List<Response>();
        for (int i = 0; i < responses.Count; i++)
        {
            Response response = responses[i];
            if (Affinity.Beats(response.Action.Skill.Kind, attack.Skill.Kind))
            {
                counters.Add(response);
            }
        }
        if (counters.Count >= attack.Skill.Tier)
        {
            // 완벽 대응이다. 처치는 가장 먼저 시작한 기술의 대원이 가져간다.
            Response credit = counters[0];
            for (int i = 0; i < counters.Count; i++)
            {
                Response response = counters[i];
                response.Action.JudgedEnemies.Add(enemy.Id);
                EndSkill(response);
                if (response.Action.Id < credit.Action.Id)
                {
                    credit = response;
                }
            }
            DamageEnemy(enemy, enemy.Hp, credit.Player, "break");
            return;
        }

        // 4. 실제로 닿은 대원만 판정한다.
        double enemyDamage = 0;
        // 비김 피해로 쓰러뜨리면 비긴 대원 중 가장 먼저 기술을 시작한 대원이 처치를 가져간다.
        Response? drawCredit = null;
        for (int i = 0; i < Players.Count; i++)
        {
            Player player = Players[i];
            if (player.State != "alive")
            {
                continue;
            }
            Response? best = null;
            int priority = -1;
            // 적의 나간 장판에 닿은 대원과, 자기 장판으로 이 적의 기운을 친 대원이 판정받는다.
            bool engaged = threatened.Contains(player);
            for (int j = 0; j < responses.Count; j++)
            {
                Response candidate = responses[j];
                if (candidate.Player != player)
                {
                    continue;
                }
                int rank = 0;
                if (candidate.Action.Skill.Kind == attack.Skill.Kind)
                {
                    rank = 1;
                }
                if (Affinity.Beats(candidate.Action.Skill.Kind, attack.Skill.Kind))
                {
                    rank = 2;
                }
                if (candidate.Initiates)
                {
                    engaged = true;
                }
                if (rank > priority)
                {
                    priority = rank;
                    best = candidate;
                }
            }
            if (!engaged)
            {
                continue;
            }
            attack.HitPlayers.Add(player.Id);
            if (best != null)
            {
                best.Action.JudgedEnemies.Add(enemy.Id);
            }
            if (priority == 2)
            {
                // 2티어에 하나만 맞춘 경우다(부분 대응). 대원은 피해 1을 받고 기술이 끊긴다.
                // 적은 기술별 부분 대응 피해를 받고 그 피해로도 쓰러지며, 처치는 이 대원이 가져간다.
                // 맞는 대응이 둘이면 위에서 완벽 대응으로 끝나므로 한 판정에 이 경우는 많아야 한 명이다.
                // 같은 적 행동에 맞는 대응이 따로 닿으면 판정마다 이 피해를 받는다.
                // 비김 피해는 대원을 모두 본 뒤에 주므로 이 피해가 먼저다. 이 피해로 쓰러지면 비김 피해는 더하지 않는다.
                CancelActions(player);
                HurtInCombat(player, 1);
                DamageEnemy(enemy, attack.Skill.PartialDamage, player, "partial");
            }
            else if (priority == 1)
            {
                // 같은 종류라 비긴다. 기술은 끊기지 않는다.
                enemyDamage += 1;
                if (best != null && (drawCredit == null || best.Action.Id < drawCredit.Action.Id))
                {
                    drawCredit = best;
                }
                HurtInCombat(player, attack.Skill.Tier);
            }
            else
            {
                // 적의 나간 장판을 받아치지 못했거나, 대원의 장판이 그것을 이기는 기운에 닿았다(적의 완벽 대응).
                // 대원만 피해를 받고 기술이 끊긴다.
                CancelActions(player);
                HurtInCombat(player, attack.Skill.Tier);
            }
        }
        // 비긴 대원이 여럿이어도 비김 효과는 판정마다 하나다. 효과는 적 자리에 그려지므로 대원마다 만들면 겹친다.
        // 부분 대응 피해로 이미 쓰러졌어도 비김은 일어났으므로 효과는 만들고, 피해는 더하지 않는다(DamageEnemy).
        if (drawCredit != null)
        {
            Effect(enemy.Position, "draw", 0.65);
            DamageEnemy(enemy, enemyDamage, drawCredit.Player, null);
        }
    }

    // 완벽 대응을 낸 기술은 거기서 끝난다. 이 틱의 다른 판정은 아직 기운을 두른 상태로 보도록, 끝내는 것은 ApplyCombatResults에서 한다.
    // 같은 순간 여러 장판을 받아친 기술은 한 번만 적는다.
    private void EndSkill(Response response)
    {
        for (int i = 0; i < _countered.Count; i++)
        {
            if (_countered[i].Action == response.Action)
            {
                return;
            }
        }
        _countered.Add(response);
    }

    // 진 대원의 기술을 끊는다. 이 틱의 다른 판정은 아직 기술을 쓰던 상태로 보도록, 끊는 것은 ApplyCombatResults에서 한다.
    private void CancelActions(Player player)
    {
        if (!_interrupted.Contains(player))
        {
            _interrupted.Add(player);
        }
    }

    // 벽을 친 효과를 벽 면에서 대원 쪽으로 당기는 거리다.
    private static readonly Fixed WallEffectInset = Fixed.FromInt(6);
    // 시설을 칠 때 시설 몸의 반지름이다.
    private static readonly Fixed FacilityRadius = Fixed.FromInt(27);

    private void ResolveStructures()
    {
        for (int i = 0; i < Players.Count; i++)
        {
            Player player = Players[i];
            if (player.State != "alive")
            {
                continue;
            }
            for (int j = 0; j < player.Actions.Count; j++)
            {
                PlayerAction action = player.Actions[j];
                // 구조물은 나간 장판이 부순다. 부수는지는 기술 속성으로 정한다. 공개되는 속성만 보고도 동작을 알 수 있어야 한다.
                if (!action.Skill.BreaksStructures || !action.ZoneOut(Tick))
                {
                    continue;
                }
                for (int k = 0; k < Facilities.Count; k++)
                {
                    Facility facility = Facilities[k];
                    if (facility.Hp > 0 && !action.HitFacilities.Contains(facility.Id) &&
                        SkillReaches(player, action.Skill, facility.Position, FacilityRadius))
                    {
                        action.HitFacilities.Add(facility.Id);
                        DamageFacility(facility);
                    }
                }
                // 벽은 조준 방향의 광선으로 친다. 둘레 기술은 조준하지 않으므로 벽을 치지 않는다.
                if (action.Skill.Around)
                {
                    continue;
                }
                FixedVector facing = player.AimDirection;
                WallHit wall = Map.RayWall(player.Position, player.Position + facing * action.Skill.RangeFixed);
                // 맵 밖에서 닿으면 Tile이 -1이다. Hit도 함께 봐서, 닿지 않은 결과(Tile이 0인 default 포함)를 0번 타일로 치지 않는다.
                if (wall.Hit && wall.Tile >= 0 && !action.HitWalls.Contains(wall.Tile))
                {
                    action.HitWalls.Add(wall.Tile);
                    // Map.Damage는 벽이 부서졌을 때만 true를 돌려주므로, 부술 수 있는 벽인지는 치기 전에 따로 본다.
                    // 시설을 칠 때처럼 칠 때마다 효과를 낸다.
                    bool breakable = Map.Tiles[wall.Tile] == 1;
                    Map.Damage(wall.Tile, 1);
                    if (breakable)
                    {
                        // 효과는 벽 면에서 대원 쪽으로 조금 당긴 곳에 둔다. 벽 면 위에 두면 시야 판정의 사선이
                        // 그 벽에 막혀, 벽이 부서지는 마지막 타격을 빼고는 스냅샷에서 걸러진다.
                        Fixed reach = Fixed.Max(Fixed.Zero, action.Skill.RangeFixed * wall.Fraction - WallEffectInset);
                        Effect(player.Position + facing * reach, "hit", 0.4);
                    }
                }
            }
        }
    }
}
