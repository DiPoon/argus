using Argus.Server.Game;
using static TestTools;

internal static class EncounterTests
{
    public static void Register(List<TestCase> tests)
    {
        tests.Add(new TestCase("The first mission has only tier-one enemies, including late reinforcements", FirstMission));
        tests.Add(new TestCase("Every initial enemy is placed at its own spot with its kind, in the first and the elite mission", InitialPlacement));
        tests.Add(new TestCase("AI telegraphs and actual hits both wait for the longer mission windup", LongerWindup));
        tests.Add(new TestCase("Reinforcements never appear inside the squad's shared sight", HiddenSpawns));
        tests.Add(new TestCase("An enemy whose body clips a wall corner on an open sight line still reaches the player", CornerSlip));
        tests.Add(new TestCase("The flow field has no heading inside its own source cell", FlowSource));
        tests.Add(new TestCase("An enemy touching a wall walks straight along it instead of zigzagging", WallHug));
        tests.Add(new TestCase("Every enemy body is narrower than a cell and walks through a one-cell gap from any side", NarrowGap));
        tests.Add(new TestCase("An enemy chasing along a line that grazes a corner closer than its radius detours instead of stopping", GrazingLine));
        tests.Add(new TestCase("A telegraphing enemy turns toward its target, so stepping aside does not leave the attack", TelegraphTracksTarget));
        tests.Add(new TestCase("A player who steps aside during any telegraph meets its affinity instead of flanking it", SidestepMeetsAffinity));
        tests.Add(new TestCase("A target circling the enemy at full speed through the telegraph is still hit as the attack window opens", WalkingAsideStillHit));
        tests.Add(new TestCase("From the attack window on, the enemy keeps the direction it had just before the window opened", WindowKeepsDirection));
        tests.Add(new TestCase("An enemy keeps turning to the player it chose even when a teammate comes closer", TargetStaysChosen));
        tests.Add(new TestCase("A teammate beside an enemy that targets someone else flanks it, also for actions the server started", TeammateFlanksTurningEnemy));
        tests.Add(new TestCase("An enemy whose target falls during the telegraph keeps its last direction", FallenTargetKeepsDirection));
        tests.Add(new TestCase("The state summary tells apart enemy actions that differ only in their target", TargetInStateHash));
        tests.Add(new TestCase("Every enemy skill reaches a player anywhere within the distance at which enemies choose an action", SkillsReachEngageDistance));
        tests.Add(new TestCase("A grunt grab chosen at the edge of the engage distance reaches a player standing still", GrabReachesStandingPlayer));
    }

    private static void InitialPlacement()
    {
        // 처음 배치하는 적은 정해진 자리마다 정해진 종류로 하나씩 생성되어야 한다. 빠지거나 다른 자리로 옮겨지면 안 된다.
        // 예전 자리 (970, 570)는 장애물 칸 (20, 11) 안이라 그 적이 한 번도 생성되지 않았고, 엘리트 작전에서는 분쇄자가 빠졌다.
        // 지금은 자리가 막혀 있으면 생성자가 예외를 내므로 이 검사가 바로 실패한다.
        string[] firstKinds = new string[] { "grunt", "grunt", "grunt" };
        string[] eliteKinds = new string[] { "grunt", "breaker", "warden" };
        CheckPlacement(new Match("PLACE1", new Rules(), 73), firstKinds);
        CheckPlacement(new Match("PLACE2", new Rules { AllowEliteEnemies = true }, 73), eliteKinds);
    }

    private static void CheckPlacement(Match match, string[] kinds)
    {
        Equal(match.Layout.InitialEnemySpots.Count, kinds.Length);
        Equal(match.Enemies.Count, kinds.Length);
        for (int i = 0; i < kinds.Length; i++)
        {
            Enemy enemy = match.Enemies[i];
            FixedVector spot = match.Layout.InitialEnemySpots[i].Position;
            Check(enemy.Position == spot, $"{i}번째 적이 {enemy.Position}에 있습니다. 자리는 {spot}입니다");
            Equal(enemy.Definition.Id, kinds[i]);
        }
    }

    private static void FirstMission()
    {
        Rules rules = new Rules();
        Fixture f = new Fixture(rules);
        Check(f.Match.Enemies.Count > 0);
        // 피격으로 작전이 일찍 끝나지 않도록 생성 규칙 검사에서만 충분한 체력을 준다.
        f.Player.Hp = 1000;
        HashSet<int> seen = new HashSet<int>();
        bool lateReinforcement = false;
        for (int step = 0; step < 90; step++)
        {
            for (int i = 0; i < f.Match.Enemies.Count; i++)
            {
                Enemy enemy = f.Match.Enemies[i];
                Equal(enemy.Definition.Id, "grunt");
                for (int j = 0; j < enemy.Definition.Skills.Length; j++)
                {
                    Equal(enemy.Definition.Skills[j].Tier, 1);
                }
                if (seen.Add(enemy.Id) && f.Match.Elapsed > 45)
                {
                    lateReinforcement = true;
                }
            }
            Advance(f.Match, 1);
        }
        Check(lateReinforcement);

        // 이후 작전에서 사용할 엘리트 정의와 생성 경로는 그대로 사용할 수 있다.
        Rules eliteRules = new Rules { AllowEliteEnemies = true, EnemyWindupMultiplier = 1 };
        Match harder = new Match("ELITE1", eliteRules, 73);
        bool containsElite = false;
        for (int i = 0; i < harder.Enemies.Count; i++)
        {
            for (int j = 0; j < harder.Enemies[i].Definition.Skills.Length; j++)
            {
                if (harder.Enemies[i].Definition.Skills[j].Tier > 1)
                {
                    containsElite = true;
                }
            }
        }
        Check(containsElite);
    }

    private static void HiddenSpawns()
    {
        Rules rules = new Rules();
        Fixture f = new Fixture(rules);
        // 생성 규칙만 확인하므로 피격으로 작전이 끝나지 않게 한다.
        f.Player.Hp = 1000;
        // 캠프의 대원 한 명만으로는 생성 타원의 왼쪽 일부만 보인다. 타원 위 세 곳에 관찰자를 세워
        // 타원 대부분이 분대 시야에 들어오게 한다. 시야 조건이 빠지면 대부분의 생성이 보이는 곳에서 일어난다.
        FixedVector[] posts = new FixedVector[] { FixedVector.FromInt(1730, 710), FixedVector.FromInt(755, 1178), FixedVector.FromInt(755, 242) };
        for (int i = 0; i < posts.Length; i++)
        {
            Check(f.Match.Map.CanStand(posts[i], Rules.PlayerRadius), "관찰자 위치가 막혀 있습니다");
            Player observer = Ally(f, "post" + i);
            observer.Position = posts[i];
            observer.Hp = 1000;
        }
        HashSet<int> seen = new HashSet<int>();
        for (int i = 0; i < f.Match.Enemies.Count; i++)
        {
            seen.Add(f.Match.Enemies[i].Id);
        }
        int observed = 0;
        // 한 틱씩 진행해 적이 생성된 직후의 위치를 확인한다. 생성된 틱에 적이 한 번 움직이므로
        // 그만큼의 거리를 허용해 판단한다.
        Fixed reach = EnemyDefinition.Grunt.StepPerTick + Fixed.One / 2;
        for (int step = 0; step < 2700; step++)
        {
            Advance(f.Match, Rules.Step);
            for (int i = 0; i < f.Match.Enemies.Count; i++)
            {
                Enemy enemy = f.Match.Enemies[i];
                if (!seen.Add(enemy.Id))
                {
                    continue;
                }
                observed++;
                Check(!SurelyVisible(f.Match, enemy.Position, reach), "분대 시야 안에서 적이 생성되었습니다");
            }
        }
        Check(observed > 0, "추가 생성된 적이 없어 검사가 아무것도 확인하지 못했습니다");
    }

    // 생성된 틱에 적이 한 번 움직였으므로 생성 위치는 지금 위치에서 reach 안쪽 어딘가다.
    // 그 범위 어느 점에서 봐도 보일 때만 시야 안에서 생성된 것으로 본다. 시야 경계 바로 밖에서 생긴 적이
    // 한 걸음 들어와 보이는 정상적인 경우를 위반으로 잘못 판단하지 않기 위해서다.
    private static bool SurelyVisible(Match match, FixedVector point, Fixed reach)
    {
        if (!match.Visible(point))
        {
            return false;
        }
        for (int i = 0; i < 8; i++)
        {
            FixedVector around = point + Angle.FromFraction(i, 8).Direction() * reach;
            if (!match.Visible(around))
            {
                return false;
            }
        }
        return true;
    }

    private static void CornerSlip()
    {
        Fixture f = new Fixture();
        f.Player.Hp = 1000;
        // 벽 타일 (32,10)–(32,11)의 아래쪽 면은 y = 576이다. y = 588 직선은 몸 중심의 사선은 열려 있지만
        // 반지름 13인 몸은 모서리에 12만큼 걸린다.
        FixedVector start = FixedVector.FromInt(1505, 588);
        f.Player.Position = FixedVector.FromInt(1615, 588);
        Check(f.Match.Map.LineOfSight(start, f.Player.Position), "사선이 막혀 있어 검사 조건이 아닙니다");
        // id가 짝수인 적은 예전 방식에서 위(벽 쪽)로 비켜 가려다 계속 걸렸다. 행동 없이 이동만 본다.
        Enemy enemy = new Enemy(30020, start, EnemyDefinition.Grunt);
        enemy.NextActionTick = long.MaxValue;
        f.Match.Enemies.Add(enemy);
        Advance(f.Match, 2);
        Check(enemy.Position.X > Fixed.FromInt(1560), "모서리에 걸려 멈췄습니다");
    }

    // 칸 가운데의 좌표다.
    private static FixedVector CellCenter(int x, int y)
    {
        return FixedVector.FromInt(x * BattleMap.Cell + BattleMap.Cell / 2, y * BattleMap.Cell + BattleMap.Cell / 2);
    }

    // 20×13 맵의 x = 10 열을 벽으로 막고 y = 6 한 칸(y 288~336)만 연 맵이다. 캠프는 벽 오른쪽 (15, 6)이다.
    private static MissionLayout GapLayout()
    {
        int columns = 20;
        int rows = 13;
        byte[] tiles = LayoutTests.BorderTiles(columns, rows);
        for (int y = 1; y < rows - 1; y++)
        {
            if (y != 6)
            {
                tiles[y * columns + 10] = 2;
            }
        }
        FixedVector[] facilities = new FixedVector[] { CellCenter(16, 2) };
        SupplySpot[] supplies = new SupplySpot[] { new SupplySpot(CellCenter(17, 3), SupplyKind.Field) };
        SpawnRing ring = new SpawnRing(CellCenter(4, 6), 96, 96);
        return new MissionLayout(columns, rows, tiles, CellCenter(15, 6), CellCenter(17, 10), facilities, supplies, new EnemySpot[0], ring);
    }

    // 그 맵에서 대원을 캠프에 투입한 방이다. 증원이 생기지 않게 적 수 상한을 1로 둔다. 검사할 적은 상한을 거치지 않고 직접 넣는다.
    private static Match GapMatch(MissionLayout layout)
    {
        Rules rules = new Rules { AllowEliteEnemies = true, MaxEnemies = 1 };
        Match match = new Match("GAP001", rules, SeededRandom.SeedFromNumber(1), layout);
        Player player = match.Join("p", "pilot")!;
        player.Connected = true;
        Check(match.Deploy(player, layout.Camp.X.ToDouble(), layout.Camp.Y.ToDouble()));
        Advance(match, rules.DeploySeconds + 0.01);
        return match;
    }

    // 행동 없이 이동만 하는 적을 start에 두고, 30초 안에 틈을 지나 벽 오른쪽(x > 528)으로 넘어오는지 본다.
    // 먼저 방의 적을 모두 치운다. 그동안 생긴 적이 틈을 막거나 밀어내면 엉뚱한 이유로 통과하거나 실패한다.
    private static bool CrossesGap(Match match, EnemyDefinition kind, FixedVector start, out FixedVector end)
    {
        match.Enemies.Clear();
        Enemy enemy = new Enemy(30050, start, kind);
        enemy.NextActionTick = long.MaxValue;
        match.Enemies.Add(enemy);
        for (long tick = 0; tick < Rules.ToTicks(30); tick++)
        {
            match.Step();
            if (enemy.Position.X > Fixed.FromInt(11 * BattleMap.Cell))
            {
                end = enemy.Position;
                return true;
            }
        }
        end = enemy.Position;
        return false;
    }

    private static void NarrowGap()
    {
        // 적의 몸 지름은 한 칸보다 작아야 한다. 지름이 한 칸과 같으면(반지름 24) 적이 따라가는 칸 가운데 줄이 벽 모서리에 딱 붙어,
        // 반올림으로 조금만 벗어나도 모서리에 걸린 채 멈춘다. 적 정의의 생성자가 그런 몸을 거절한다.
        Throws<ArgumentOutOfRangeException>(() => new EnemyDefinition("wide", "넓은 적", Fixed.FromInt(BattleMap.Cell / 2), 1, 50, EnemyDefinition.Grunt.Skills));

        // 모든 적 종류가 틈 왼쪽 여러 칸에서 출발해 한 칸 틈을 지나 캠프의 대원에게 간다. 틈에 비스듬히 다가가는 출발점이 많다.
        MissionLayout layout = GapLayout();
        int[] startX = new int[] { 4, 4, 4, 7, 8, 2, 9 };
        int[] startY = new int[] { 6, 2, 10, 3, 9, 1, 11 };
        for (int k = 0; k < EnemyDefinition.All.Count; k++)
        {
            EnemyDefinition kind = EnemyDefinition.All[k];
            for (int s = 0; s < startX.Length; s++)
            {
                Match match = GapMatch(layout);
                FixedVector end;
                bool passed = CrossesGap(match, kind, CellCenter(startX[s], startY[s]), out end);
                Check(passed, $"({startX[s]}, {startY[s]})에서 출발한 {kind.Name}: 한 칸 틈을 지나지 못하고 {end}에 멈췄습니다");
            }
        }
    }

    private static void GrazingLine()
    {
        // 몸 통과 판단은 옆선을 반지름보다 0.5 좁게 그어, 모서리를 반지름보다 0.5 미만으로 가깝게 스치는 직선도 지나갈 수 있다고 본다.
        // 대원과 적이 그런 줄에 함께 서면 직진하는 방향의 옆 성분이 0이라, 적은 모서리에 걸린 채 미끄러지지도 못하고 멈췄다.
        // 그런 줄에서 출발한 적도 흐름장으로 돌아 틈을 지나야 한다. 틈 위 모서리 (480, 288)와 아래 모서리 (480, 336)를 모두 본다.
        MissionLayout layout = GapLayout();
        double[] shortBy = new double[] { 0.1, 0.25, 0.4, 0.6, 1 };
        for (int k = 0; k < EnemyDefinition.All.Count; k++)
        {
            EnemyDefinition kind = EnemyDefinition.All[k];
            for (int i = 0; i < shortBy.Length; i++)
            {
                Fixed shortfall = Fixed.FromDouble(shortBy[i]);
                Fixed[] lines = new Fixed[] { Fixed.FromInt(288) + kind.Radius - shortfall, Fixed.FromInt(336) - kind.Radius + shortfall };
                for (int l = 0; l < lines.Length; l++)
                {
                    Match match = GapMatch(layout);
                    match.Players[0].Position = new FixedVector(Fixed.FromInt(744), lines[l]);
                    FixedVector end;
                    bool passed = CrossesGap(match, kind, new FixedVector(Fixed.FromInt(216), lines[l]), out end);
                    Check(passed, $"{kind.Name}: 모서리를 반지름보다 {shortBy[i]} 가깝게 스치는 줄(y = {lines[l]})에서 {end}에 멈췄습니다");
                }
            }
        }
    }

    private static void FlowSource()
    {
        // 대원은 캠프에 있고 흐름장도 캠프 칸을 출발점(비용 0)으로 만들어졌다.
        Fixture f = new Fixture();
        // 출발점 칸 안에서는 더 나은 이웃이 없다. 이웃 칸(비용 1)으로 향하면 대원에게서 멀어진다.
        FixedVector inside = f.Match.FlowHeading(f.Match.Layout.Camp);
        Check(inside.IsZero(), "출발점 칸 안에서 이웃 칸으로 향합니다");
        // 옆 칸에서는 출발점 칸 쪽을 가리킨다.
        FixedVector beside = f.Match.FlowHeading(f.Match.Layout.Camp + FixedVector.FromInt(BattleMap.Cell, 0));
        Check(beside.X < Fixed.Zero, "옆 칸에서 출발점 쪽을 가리키지 않습니다");
    }

    private static void WallHug()
    {
        Fixture f = new Fixture();
        f.Player.Hp = 1000;
        // 벽 타일 (32,10)–(32,11)의 왼쪽 면은 x = 1536이다. 반지름 13인 적이 면에 딱 붙어 아래로 내려간다.
        FixedVector start = FixedVector.FromInt(1523, 470);
        f.Player.Position = FixedVector.FromInt(1523, 650);
        Enemy enemy = new Enemy(30030, start, EnemyDefinition.Grunt);
        enemy.NextActionTick = long.MaxValue;
        f.Match.Enemies.Add(enemy);
        Advance(f.Match, 1);
        Check(enemy.Position.Y > start.Y + Fixed.FromInt(60), "아래로 내려가지 않았습니다");
        // 몸이 지나갈 수 있는 직선이므로 옆으로 흔들리지 않아야 한다.
        Check(Fixed.Abs(enemy.Position.X - start.X) < Fixed.One, "벽에 붙은 적이 직진하지 않고 옆으로 흔들립니다");
    }

    // 대원 오른쪽 distance의 병사가 skill 하나만 쓰게 하고, 한 틱 진행해 서버가 스스로 그 대원을 노린 행동을 시작하게 한다.
    // 적은 병사 정의의 몸과 체력을 그대로 쓰고 기술만 skill 하나로 줄인다. 움직이지 않는다(Target).
    // 선딜 배율은 규칙의 값이고, 기본 규칙은 두 배다.
    private static Enemy Telegraphing(Fixture f, EnemySkill skill, int distance = 50)
    {
        EnemyDefinition grunt = EnemyDefinition.Grunt;
        EnemyDefinition single = new EnemyDefinition(grunt.Id, grunt.Name, grunt.Radius, grunt.Health, grunt.Speed,
            new EnemySkill[] { skill });
        Enemy enemy = Target(f, single);
        enemy.Position = f.Player.Position + FixedVector.FromInt(distance, 0);
        enemy.NextActionTick = f.Match.Tick;
        f.Match.Step();
        Check(enemy.Action != null, "적이 행동을 시작하지 않았습니다");
        return enemy;
    }

    // 병사의 kind 기술이다.
    private static EnemySkill GruntSkill(string kind)
    {
        EnemySkill? found = null;
        for (int i = 0; i < EnemyDefinition.Grunt.Skills.Length; i++)
        {
            if (EnemyDefinition.Grunt.Skills[i].Kind == kind)
            {
                found = EnemyDefinition.Grunt.Skills[i];
            }
        }
        Check(found != null, $"병사에게 {kind} 기술이 없습니다");
        return found!;
    }

    // 대원이 enemy를 가운데 두고 도는 방향(적→대원 방향에 수직)으로 최고 속도로 걷는 입력을 보내고 한 틱 진행한다.
    private static void CircleStep(Fixture f, Enemy enemy, long sequence)
    {
        FixedVector offset = f.Player.Position - enemy.Position;
        double x = offset.X.ToDouble();
        double y = offset.Y.ToDouble();
        double length = Math.Sqrt(x * x + y * y);
        Check(f.Match.Input(f.Player, sequence, -y / length, x / length, 0));
        f.Match.Step();
    }

    private static void TelegraphTracksTarget()
    {
        // 병사가 대원을 노려 타격을 예고한다. 대원이 예고 중에 병사의 옆으로 돌아가면 병사도 그쪽으로 돈다.
        Fixture f = new Fixture();
        Enemy enemy = Telegraphing(f, GruntSkill("strike"));
        EnemyAction action = enemy.Action!;
        Equal(action.TargetId, f.Player.Id);
        // 화면이 나를 노린 예고를 알아보도록 스냅샷에도 노린 대원이 담긴다.
        Equal(Snapshot.CreateShared(f.Match).Enemies[0].Action!.Target, f.Player.Id);
        f.Player.Position = enemy.Position + FixedVector.FromInt(0, 50);
        f.Match.Step();
        Equal(action.Aim.Units, Angle.Of(f.Player.Position - enemy.Position).Units);
        // 대원이 그 자리에 있으면 타격을 맞는다. 예전에는 처음 방향으로 쳐서 옆으로 비킨 대원에게 닿지 않았다.
        StepUntil(f.Match, action.ActiveUntilTick);
        Near(f.Player.Hp, f.Player.MaxHp - 1);
    }

    private static void SidestepMeetsAffinity()
    {
        // 2026-11-05 사용자 제보의 장면이다. 예고를 보고 옆으로 비켜 서서 상성이 지는 둘레 기술을 쓴다.
        // 예전에는 대원이 행동의 범위 밖이라 측면 공격이 되어, 상성과 관계없이 일반 피해 1로 병사를 쓰러뜨렸다.
        // 이제 병사가 대원 쪽으로 돌았으므로 병사의 행동이 이긴다. 대원이 피해 1을 받고 병사는 살아 있다. 행동 셋 모두 같다.
        string[] kinds = new string[] { "strike", "block", "channel" };
        // 각 행동에 지는 둘레 기술이다. 타격은 잡기를, 방어는 타격을, 잡기는 방어를 이긴다.
        string[] losing = new string[] { "spingrab", "spin", "spinblock" };
        for (int i = 0; i < kinds.Length; i++)
        {
            Fixture f = new Fixture();
            Enemy enemy = Telegraphing(f, GruntSkill(kinds[i]));
            EnemyAction action = enemy.Action!;
            f.Player.Position = enemy.Position + FixedVector.FromInt(0, 50);
            // 장판이 나가기 세 틱 전에 둘레 기술을 시작한다. 예고 중에는 지는 기운이라 아무 일도 없고,
            // 장판이 나가 닿을 때 둘레 기술의 기운은 아직 돌고 있다.
            StepUntil(f.Match, action.ContactTick - 3);
            Prepare(f, f.Player, losing[i]);
            StepUntil(f.Match, action.EndsTick);
            Check(f.Player.Hp == f.Player.MaxHp - 1, $"{kinds[i]}: 대원 체력 {f.Player.Hp}");
            Check(enemy.Hp == 1, $"{kinds[i]}: 병사가 쓰러졌습니다");
        }
    }

    private static void WalkingAsideStillHit()
    {
        // 2026-11-08 사용자 결정의 장면이다. 노린 대원이 예고를 보자마자 병사 둘레를 최고 속도로 돌아도, 병사가 따라 돌아
        // 공격 창이 열리는 첫 순간에 맞는다. 걸어서 피하는 것은 의도한 동작이 아니다. 피하기는 앞으로 추가될 대시 같은 기술이 맡는다.
        // 병사가 마지막으로 돈 뒤 판정까지 대원은 한 틱(6)만 걷고, 맞는 폭은 그보다 넓다.
        string[] kinds = new string[] { "strike", "block", "channel" };
        for (int i = 0; i < kinds.Length; i++)
        {
            Fixture f = new Fixture();
            Enemy enemy = Telegraphing(f, GruntSkill(kinds[i]));
            EnemyAction action = enemy.Action!;
            long sequence = 0;
            while (f.Match.Tick < action.ContactTick)
            {
                CircleStep(f, enemy, sequence);
                sequence++;
            }
            Check(f.Player.Hp == f.Player.MaxHp - 1, $"{kinds[i]}: 대원 체력 {f.Player.Hp}");
        }
    }

    private static void WindowKeepsDirection()
    {
        // 대원이 예고부터 회복이 끝날 때까지 병사 둘레를 걷는다. 병사는 공격 창이 열리기 직전의 틱까지 돌고,
        // 공격 창이 열리는 틱부터는 그 방향을 유지한다.
        Fixture f = new Fixture();
        Enemy enemy = Telegraphing(f, GruntSkill("strike"));
        EnemyAction action = enemy.Action!;
        long sequence = 0;
        int lastTurn = 0;
        while (f.Match.Tick < action.EndsTick - 1)
        {
            CircleStep(f, enemy, sequence);
            sequence++;
            if (f.Match.Tick == action.ContactTick - 1)
            {
                lastTurn = action.Aim.Units;
            }
            if (f.Match.Tick >= action.ContactTick)
            {
                Check(action.Aim.Units == lastTurn, $"{f.Match.Tick}틱: 공격 창이 열린 뒤에 돌았습니다");
            }
        }
    }

    private static void TargetStaysChosen()
    {
        // 병사는 가장 가까운 대원을 노려 예고한다. 예고 중에 동료가 더 가까이 와도 처음 노린 대원 쪽으로 돈다.
        Fixture f = new Fixture();
        Player ally = Ally(f, "ally");
        ally.Position = f.Player.Position + FixedVector.FromInt(-60, 0);
        Enemy enemy = Telegraphing(f, GruntSkill("strike"));
        EnemyAction action = enemy.Action!;
        Equal(action.TargetId, f.Player.Id);
        ally.Position = enemy.Position + FixedVector.FromInt(0, -40);
        f.Player.Position = enemy.Position + FixedVector.FromInt(0, 50);
        f.Match.Step();
        Equal(action.Aim.Units, Angle.Of(f.Player.Position - enemy.Position).Units);
    }

    private static void TeammateFlanksTurningEnemy()
    {
        // 다른 대원을 노리는 적은 동료가 옆에서 칠 수 있다(합의 규칙, docs/combat.md). 서버가 만든 도는 행동에서도 측면이다.
        // 병사가 타격을 예고하는 동안 동료가 병사 옆에서 상성이 지는 회전 잡기의 장판으로 친다. 병사의 기운은 노린 대원 쪽으로만
        // 돌므로, 범위 밖의 동료는 일반 피해 1로 병사를 쓰러뜨리고 다치지 않는다. 노린 대원도 그 타격을 맞지 않는다.
        Fixture f = new Fixture();
        Player ally = Ally(f, "ally");
        ally.Position = f.Player.Position + FixedVector.FromInt(-60, 0);
        Enemy enemy = Telegraphing(f, GruntSkill("strike"));
        EnemyAction action = enemy.Action!;
        Equal(action.TargetId, f.Player.Id);
        ally.Position = enemy.Position + FixedVector.FromInt(0, 50);
        // 회전 잡기의 장판은 시작 6틱 뒤에 나간다. 병사의 장판이 나가기 네 틱 전이라 병사는 아직 예고 중이다.
        StepUntil(f.Match, action.ContactTick - 10);
        PlayerAction spin = Prepare(f, ally, "spingrab");
        Check(spin.ZoneTick < action.ContactTick, "병사의 장판이 먼저 나갑니다");
        StepUntil(f.Match, action.EndsTick);
        Near(enemy.Hp, 0);
        Near(ally.Hp, ally.MaxHp);
        Near(f.Player.Hp, f.Player.MaxHp);
    }

    private static void FallenTargetKeepsDirection()
    {
        // 예고 중에 노린 대원이 쓰러지면, 다른 대원 쪽으로 바꾸지 않고 마지막 방향을 유지한다.
        Fixture f = new Fixture();
        Player ally = Ally(f, "ally");
        ally.Position = f.Player.Position + FixedVector.FromInt(-60, 0);
        Enemy enemy = Telegraphing(f, GruntSkill("strike"));
        EnemyAction action = enemy.Action!;
        int aim = action.Aim.Units;
        ally.Position = enemy.Position + FixedVector.FromInt(0, -40);
        f.Player.State = "waiting";
        f.Match.Step();
        Equal(action.Aim.Units, aim);
    }

    private static void TargetInStateHash()
    {
        // 노린 대원도 진행 상태다. "상태 필드는 모두 StateHash에 넣는다"는 규칙대로 요약에 든다.
        // 같은 방의 같은 적에서 행동이 노린 대원만 바꿔 비교한다. 노린 대원이 있고 없음만이 아니라 누구인지도 요약에 들어야 한다.
        Fixture f = new Fixture();
        Player ally = Ally(f, "ally");
        Enemy enemy = Target(f);
        EnemySkill skill = EnemyDefinition.Grunt.Skills[0];
        enemy.Action = new EnemyAction(901, skill, Angle.Zero, f.Match.Tick, 1, f.Player.Id);
        string first = f.Match.StateHash();
        enemy.Action = new EnemyAction(901, skill, Angle.Zero, f.Match.Tick, 1, ally.Id);
        Check(first != f.Match.StateHash(), "노린 대원만 다른데 상태 요약이 같습니다");
    }

    private static void SkillsReachEngageDistance()
    {
        // 적은 가장 가까운 대원이 행동 거리(EngageDistance) 안이면 기술 하나를 고른다. 고른 기술이 그 거리에 닿지 않으면
        // 가만히 선 대원에게도 빗나가고, 그 뒤 회복 동안에는 아무 기술로나 칠 수 있다(PR #22 리뷰 5번, 병사 잡기 60 + 13 = 73 < 75).
        Fixed engage = Fixed.FromInt(Match.EngageDistance);
        for (int i = 0; i < EnemyDefinition.All.Count; i++)
        {
            EnemyDefinition definition = EnemyDefinition.All[i];
            for (int j = 0; j < definition.Skills.Length; j++)
            {
                EnemySkill skill = definition.Skills[j];
                Check(skill.RangeFixed + Rules.PlayerRadius >= engage, $"{definition.Id}의 {skill.Kind}가 행동 거리에 닿지 않습니다");
            }
        }
    }

    private static void GrabReachesStandingPlayer()
    {
        // 리뷰 5번의 장면이다. 가만히 선 대원에게서 74 떨어진 병사가 잡기를 고른다. 행동 거리 75 안이므로 잡기가 닿아야 한다.
        Fixture f = new Fixture();
        Enemy enemy = Telegraphing(f, GruntSkill("channel"), 74);
        StepUntil(f.Match, enemy.Action!.EndsTick);
        Near(f.Player.Hp, f.Player.MaxHp - 1);
    }

    private static void LongerWindup()
    {
        for (int i = 0; i < EnemyDefinition.Grunt.Skills.Length; i++)
        {
            EnemySkill skill = EnemyDefinition.Grunt.Skills[i];
            for (int setting = 0; setting < 2; setting++)
            {
                Rules rules = new Rules { MaxEnemies = 0 };
                if (setting == 1)
                {
                    rules = new Rules { MaxEnemies = 0, EnemyWindupMultiplier = 1 };
                }
                Fixture f = new Fixture(rules);
                Enemy enemy = Telegraphing(f, skill);
                EnemyAction action = enemy.Action!;
                double expected = skill.Windup * rules.EnemyWindupMultiplier;
                // 예고 길이는 틱으로 올려 센다. 배율 1의 0.85초 예고는 26틱(약 0.867초)이다.
                // 클라이언트에 보내는 예고도 실제 접촉과 같은 틱을 가리켜야 한다. 보내는 시각은 반올림되어 있으므로
                // 각각 30을 곱해 반올림해 틱으로 되돌린 뒤 비교한다.
                long windupTicks = Rules.ToTicks(expected);
                Equal(action.ContactTick - action.StartedTick, windupTicks);
                SnapshotMessage snapshot = Snapshot.CreateShared(f.Match);
                ActionSnapshot tell = snapshot.Enemies[0].Action!;
                long tellStart = (long)Math.Round(tell.StartedAt * Rules.TicksPerSecond);
                long tellContact = (long)Math.Round(tell.ContactAt * Rules.TicksPerSecond);
                Equal(tellContact - tellStart, windupTicks);
                Equal(tell.Phase, "telegraph");
                Advance(f.Match, expected - Rules.Step);
                Near(f.Player.Hp, f.Player.MaxHp);
                Advance(f.Match, Rules.Step * 2);
                Near(f.Player.Hp, f.Player.MaxHp - 1);
            }
        }
    }
}
