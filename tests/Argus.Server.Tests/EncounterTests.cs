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
        tests.Add(new TestCase("The wall a body runs into is the cell it overlaps most, seen from where the body stands now", DeepestWallCell));
        tests.Add(new TestCase("Two enemies rounding a wall corner together both reach the player instead of blocking each other", CornerPair));
        tests.Add(new TestCase("Two enemies of any kinds that arrive at a one-cell gap side by side both get through", GapPairs));
        tests.Add(new TestCase("When two enemies are equally far along, the one with the smaller id goes first whatever their order in the list", TieGoesToSmallerId));
        tests.Add(new TestCase("Enemies pressing on a one-cell gap from above, below and behind all get through, the ones behind giving way in turn", GapCrowds));
        tests.Add(new TestCase("Six to eight enemies rushing a one-cell gap all get through, giving way down the line", GapRushes));
        tests.Add(new TestCase("Enemies that come through a gap in single file spread around the player instead of queueing behind the first", SingleFile));
        tests.Add(new TestCase("An enemy gives way only to one ahead that is still on the move, not to one that has reached the player or stands behind others", GivesWayOnlyToMovers));
        tests.Add(new TestCase("A faster enemy following a slower one in single file slows down behind it instead of rocking back and forth", FollowsInLine));
        tests.Add(new TestCase("The enemy further along the path goes first, and on cells equally far along, the one nearer the player", AheadOrder));
        tests.Add(new TestCase("An enemy blocked head-on by another goes round on the player's side and then stands still", SidestepSettles));
        tests.Add(new TestCase("Enemies that have reached the player, or wait behind those who have, stand still instead of trembling", CrowdSettles));
        tests.Add(new TestCase("Enemies waiting behind others that are attacking stand still instead of milling about", WaitersBehindAttackers));
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
        // 그런 줄에서 출발한 적도 모서리를 끼고 돌아 틈을 지나야 한다. 틈 위 모서리 (480, 288)와 아래 모서리 (480, 336)를 모두 본다.
        // 2026-11-14 전에는 직진이 반 걸음도 못 가면 흐름장 방향으로 다시 구했다. 지금은 막은 모서리를 끼고 돈다(Match.Slide).
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

    // 행동 없이 이동만 하는 적들을 그 자리에 둔다. 먼저 방의 적을 모두 치운다. kinds·x·y는 적마다의 종류와 자리이고, 그 차례로 id를 붙인다.
    private static List<Enemy> Crowd(Match match, EnemyDefinition[] kinds, int[] x, int[] y)
    {
        match.Enemies.Clear();
        List<Enemy> crowd = new List<Enemy>();
        for (int i = 0; i < kinds.Length; i++)
        {
            Enemy enemy = new Enemy(30100 + i, FixedVector.FromInt(x[i], y[i]), kinds[i]);
            enemy.NextActionTick = long.MaxValue;
            match.Enemies.Add(enemy);
            crowd.Add(enemy);
        }
        return crowd;
    }

    // 틈 맵의 장면 하나를 만든다. 대원을 (playerX, playerY)에 두고, spots에 적은 적들을 그 차례로 놓는다(적 목록의 차례이자 id의 차례).
    // spots는 적마다 "종류:x,y"를 빈칸으로 이은 글이다. 종류는 g(병사), b(분쇄자), w(철위병)다. 적은 행동 없이 이동만 한다.
    private static List<Enemy> GapScene(out Match match, int playerX, int playerY, string spots)
    {
        match = GapMatch(GapLayout());
        match.Players[0].Position = FixedVector.FromInt(playerX, playerY);
        return Place(match, spots);
    }

    // spots에 적은 적들을 그 차례로 놓는다. 먼저 방의 적을 모두 치운다.
    private static List<Enemy> Place(Match match, string spots)
    {
        string[] parts = spots.Split(' ');
        EnemyDefinition[] kinds = new EnemyDefinition[parts.Length];
        int[] x = new int[parts.Length];
        int[] y = new int[parts.Length];
        for (int i = 0; i < parts.Length; i++)
        {
            string[] kindAndSpot = parts[i].Split(':');
            string[] spot = kindAndSpot[1].Split(',');
            kinds[i] = EnemyDefinition.Grunt;
            if (kindAndSpot[0] == "b")
            {
                kinds[i] = EnemyDefinition.Breaker;
            }
            if (kindAndSpot[0] == "w")
            {
                kinds[i] = EnemyDefinition.Warden;
            }
            x[i] = int.Parse(spot[0]);
            y[i] = int.Parse(spot[1]);
        }
        return Crowd(match, kinds, x, y);
    }

    // 시드로 만든 생성 맵의 장면 하나를 만든다. 대원을 캠프에 투입한 뒤 (playerX, playerY)로 옮기고, 처음 적을 치운 다음
    // spots에 적은 적들을 놓는다(GapScene과 같은 글). 증원이 생기지 않게 적 수 상한을 1로 둔다.
    private static List<Enemy> MapScene(out Match match, int seed, int playerX, int playerY, string spots)
    {
        byte[] bytes = SeededRandom.SeedFromNumber(seed);
        MissionLayout layout = MissionGenerator.Generate(bytes);
        Rules rules = new Rules { AllowEliteEnemies = true, EnemyWindupMultiplier = 1, MaxEnemies = 1 };
        match = new Match("SCENE" + seed, rules, bytes, layout);
        Player player = match.Join("p", "pilot")!;
        player.Connected = true;
        Check(match.Deploy(player, layout.Camp.X.ToDouble(), layout.Camp.Y.ToDouble()));
        Advance(match, rules.DeploySeconds + 0.01);
        player.Position = FixedVector.FromInt(playerX, playerY);
        return Place(match, spots);
    }

    // 장면의 적들이 reachBy초 안에 모두 대원의 공격 거리 안에 들어오고, seconds초 뒤에도 모두 그 안에 가만히 서 있는지 본다.
    // 가만히는 마지막 3초 동안 아무도 1 넘게 움직이지 않는 것이다. 틱마다 몸이 놓일 수 없는 자리에 있지 않은지도 본다.
    // 이 도우미로 보는 장면은 2026-11-14에 저장소 밖 실험 도구로 고른 것이다. 적을 아무 데나 놓은 장면 수천 개에서, 처음 자리를
    // ±2씩 흔든 열두 가지가 모두 통과하고, 그 장면이 보려는 규칙을 틀리게 바꾸면 실패하는 장면만 골랐다(대부분은 흔든 열두 가지가
    // 거의 다 실패한다). 그래서 조향을 조금 손봤을 때 우연히 갈리는 장면이 아니라 그 규칙이 하는 일을 보는 장면이다.
    // reachBy는 고칠 때 잰 시간(주석의 "지금")의 한 배 반쯤이다.
    private static void CheckSettles(string name, Match match, List<Enemy> crowd, double reachBy, double seconds)
    {
        long total = Rules.ToTicks(seconds);
        long settled = total - Rules.ToTicks(3);
        long reachedAt = -1;
        Fixed[] travelled = new Fixed[crowd.Count];
        FixedVector[] before = new FixedVector[crowd.Count];
        for (long tick = 1; tick <= total; tick++)
        {
            for (int i = 0; i < crowd.Count; i++)
            {
                before[i] = crowd[i].Position;
            }
            match.Step();
            CheckBodies(match);
            bool all = true;
            for (int i = 0; i < crowd.Count; i++)
            {
                if (!InReach(match, crowd[i]))
                {
                    all = false;
                }
                if (tick > settled)
                {
                    travelled[i] += FixedVector.Distance(crowd[i].Position, before[i]);
                }
            }
            if (all && reachedAt < 0)
            {
                reachedAt = tick;
            }
        }
        for (int i = 0; i < crowd.Count; i++)
        {
            Enemy enemy = crowd[i];
            Fixed distance = FixedVector.Distance(enemy.Position, match.Players[0].Position);
            Check(InReach(match, enemy), $"{name}: {enemy.Definition.Name}가 대원에게 붙지 못하고 {enemy.Position}(거리 {distance})에 섰습니다");
            Check(travelled[i] < Fixed.One, $"{name}: {enemy.Definition.Name}({enemy.Position})가 자리를 잡은 뒤에도 3초 동안 {travelled[i]}만큼 움직였습니다");
        }
        Check(reachedAt >= 0 && reachedAt <= Rules.ToTicks(reachBy), $"{name}: 모두 공격 거리 안에 든 때가 {Rules.ToSeconds(reachedAt)}초입니다({reachBy}초 안이어야 함)");
    }

    // 틈 맵의 장면을 25초 동안 본다(CheckSettles).
    private static void CheckSurrounds(string name, int playerX, int playerY, string spots, double reachBy)
    {
        Match match;
        List<Enemy> crowd = GapScene(out match, playerX, playerY, spots);
        CheckSettles(name, match, crowd, reachBy, 25);
    }

    // 적이 대원의 공격 거리 안에 들어와 있고 사선이 열려 있는지다. 행동하는 적이라면 여기서 행동을 고른다.
    private static bool InReach(Match match, Enemy enemy)
    {
        Player player = match.Players[0];
        Fixed limit = Fixed.FromInt(Match.EngageDistance * Match.EngageDistance);
        if (FixedVector.DistanceSquared(enemy.Position, player.Position) >= limit)
        {
            return false;
        }
        return match.Map.LineOfSight(enemy.Position, player.Position);
    }

    // 적들의 몸이 놓일 수 없는 자리에 있지 않은지 본다. 벽과 겹치지 않고, 서로 겹치지 않고, 대원과 겹치지 않아야 한다.
    // 끼고 도는 이동은 가로·세로가 아닌 방향으로 몸을 옮기므로, 틱마다 이것을 확인해 벽이나 다른 몸을 파고드는 걸음을 잡는다.
    // 닿아 있는 몸은 거리의 제곱이 반올림으로 조금 작게 나올 수 있어 그만큼(0.01)은 봐준다.
    public static void CheckBodies(Match match)
    {
        Fixed slack = Fixed.FromDouble(0.01);
        for (int i = 0; i < match.Enemies.Count; i++)
        {
            Enemy enemy = match.Enemies[i];
            Check(match.Map.CanStand(enemy.Position, enemy.Definition.Radius), $"{match.Tick}틱: {enemy.Definition.Name}가 벽과 겹친 {enemy.Position}에 있습니다");
            for (int j = i + 1; j < match.Enemies.Count; j++)
            {
                Enemy other = match.Enemies[j];
                Fixed minimum = enemy.Definition.Radius + other.Definition.Radius;
                bool apart = FixedVector.DistanceSquared(enemy.Position, other.Position) >= minimum * minimum - slack;
                Check(apart, $"{match.Tick}틱: {enemy.Definition.Name} {enemy.Position}와 {other.Definition.Name} {other.Position}의 몸이 겹쳤습니다");
            }
            for (int j = 0; j < match.Players.Count; j++)
            {
                Player player = match.Players[j];
                if (player.State != "alive")
                {
                    continue;
                }
                Fixed minimum = enemy.Definition.Radius + Rules.PlayerRadius;
                bool apart = FixedVector.DistanceSquared(enemy.Position, player.Position) >= minimum * minimum - slack;
                Check(apart, $"{match.Tick}틱: {enemy.Definition.Name} {enemy.Position}의 몸이 대원 {player.Position}와 겹쳤습니다");
            }
        }
    }

    // seconds 안에 모든 적이 대원의 공격 거리 안에 들어오는지 본다. 끝까지 들어오지 못한 적이 있으면 그 가운데 첫 적을 late에 담는다.
    // 가는 동안 틱마다 몸이 놓일 수 없는 자리에 있지 않은지도 본다.
    private static bool AllReach(Match match, List<Enemy> crowd, double seconds, out Enemy? late)
    {
        late = null;
        for (long tick = 0; tick < Rules.ToTicks(seconds); tick++)
        {
            match.Step();
            CheckBodies(match);
            late = null;
            for (int i = 0; i < crowd.Count; i++)
            {
                if (!InReach(match, crowd[i]))
                {
                    late = crowd[i];
                    break;
                }
            }
            if (late == null)
            {
                return true;
            }
        }
        return false;
    }

    private static void DeepestWallCell()
    {
        // 끼고 돌 방향은 몸이 가장 깊이 겹친 벽 칸에서 구한다(BattleMap.DeepestWall). 틈 맵의 벽 줄(x 480~528)의 서쪽 면으로
        // 반지름 13인 몸이 3만큼 파고든 자리(x = 470)를 본다. 벽 면은 여러 칸이 이어져 있어, 몸이 칸의 경계 가까이에 있으면
        // 이웃 칸과도 조금(1.3) 겹친다. 이웃 칸을 고르면 그 칸의 모서리에서 몸 쪽으로 비스듬한 방향이 나와, 평평한 면을 따라가지 못한다.
        // 이웃 칸이 먼저 찾는 칸일 때(y = 150, 위쪽 칸 (10, 2))와 나중에 찾는 칸일 때(y = 186, 아래쪽 칸 (10, 4))를 모두 본다.
        BattleMap map = GapMatch(GapLayout()).Map;
        Fixed radius = Fixed.FromInt(13);
        int[] rows = new int[] { 150, 186 };
        for (int i = 0; i < rows.Length; i++)
        {
            // 몸은 지금 벽에 딱 붙은 자리(x = 467)에 서 있고, 벽 쪽으로 3 들어간 자리로 가려 한다.
            FixedVector from = FixedVector.FromInt(467, rows[i]);
            FixedVector to = FixedVector.FromInt(470, rows[i]);
            FixedVector away;
            Fixed depth;
            bool hit = map.DeepestWall(to, radius, from, out away, out depth);
            Check(hit, $"y = {rows[i]}: 벽과 겹친 자리인데 막은 벽을 찾지 못했습니다");
            Check(depth == Fixed.FromInt(3), $"y = {rows[i]}: 가장 깊이 겹친 깊이는 3인데 {depth}입니다");
            // 벽 면에서 몸 쪽은 정서쪽이다. 지금 선 자리에서 본 방향이라 길이는 벽 면까지의 거리(13)다.
            Check(away == FixedVector.FromInt(-13, 0), $"y = {rows[i]}: 벽 면에서 몸 쪽은 (-13, 0)인데 {away}입니다");
        }
        // 벽과 겹치지 않는 자리면 막은 벽이 없다.
        FixedVector clear;
        Fixed none;
        Check(!map.DeepestWall(FixedVector.FromInt(467, 150), radius, FixedVector.FromInt(460, 150), out clear, out none), "벽에 닿기만 한 자리를 막혔다고 했습니다");
    }

    private static void CornerPair()
    {
        // 2026-11-10에 찾은 장면이다. 손으로 만든 맵에서 분쇄자와 병사가 벽 모서리 (1440, 1056)를 함께 돌아 위의 대원에게 간다.
        // 분쇄자는 모서리에 걸려 오른쪽으로 조금 비켜야 돌 수 있는데 그 오른쪽 아래에 병사가 붙고, 병사는 위로 가야 하는데
        // 분쇄자가 막는다. 가로와 세로를 따로만 움직이던 때에는 5초 뒤 (1454.7, 1073.1)과 (1465.7, 1106.4)에서 멈춰 그대로였다.
        // 모서리를 비스듬히 끼고 도는 길은 열려 있었다. 하나씩이면 그때도 15초 안에 왔다.
        Fixture f = new Fixture();
        f.Player.Position = FixedVector.FromInt(1464, 696);
        EnemyDefinition[] kinds = new EnemyDefinition[] { EnemyDefinition.Breaker, EnemyDefinition.Grunt };
        List<Enemy> pair = Crowd(f.Match, kinds, new int[] { 1300, 1288 }, new int[] { 1078, 1114 });
        Enemy? late;
        bool reached = AllReach(f.Match, pair, 15, out late);
        Check(reached, $"모서리를 함께 돌던 적이 서로 막고 멈췄습니다: {late?.Definition.Name} {late?.Position}");
    }

    private static void GapPairs()
    {
        // 한 칸 틈(x 480~528, y 288~336) 앞에 두 적이 위아래에서 나란히 다가온다. 틈은 한 번에 하나만 지난다.
        // 서로 똑같이 밀어내던 때에는 둘이 틈 어귀에서 서로를 막은 채 양쪽 모서리에 걸려, 어느 종류의 짝이든 그대로 멈췄다.
        // 대원에게 더 가까운 적이 앞서고, 뒤선 적이 그 길에서 비켜난다. 가까운 정도가 같으면 id가 작은 적이 앞선다.
        MissionLayout layout = GapLayout();
        for (int first = 0; first < EnemyDefinition.All.Count; first++)
        {
            for (int second = 0; second < EnemyDefinition.All.Count; second++)
            {
                Match match = GapMatch(layout);
                EnemyDefinition[] kinds = new EnemyDefinition[] { EnemyDefinition.All[first], EnemyDefinition.All[second] };
                List<Enemy> pair = Crowd(match, kinds, new int[] { 430, 430 }, new int[] { 270, 354 });
                Enemy? late;
                bool reached = AllReach(match, pair, 30, out late);
                Check(reached, $"{kinds[0].Name}와 {kinds[1].Name}: 틈 앞에서 서로 막고 멈췄습니다({late?.Definition.Name} {late?.Position})");
            }
        }
    }

    private static void TieGoesToSmallerId()
    {
        // 한 칸 틈 앞에 두 병사가 위아래로 똑같은 거리에 선다. 길의 칸 수도 대원까지의 거리도 같으므로 id가 작은 적이 앞서 틈을 먼저 지난다.
        // 적 목록에서 어느 쪽이 먼저든 같아야 한다. 목록 차례로 정하면 같은 장면이 적이 생긴 차례에 따라 다르게 흘러간다.
        MissionLayout layout = GapLayout();
        for (int order = 0; order < 2; order++)
        {
            Match match = GapMatch(layout);
            match.Enemies.Clear();
            Enemy upper = new Enemy(30120, FixedVector.FromInt(430, 270), EnemyDefinition.Grunt);
            Enemy lower = new Enemy(30110, FixedVector.FromInt(430, 354), EnemyDefinition.Grunt);
            upper.NextActionTick = long.MaxValue;
            lower.NextActionTick = long.MaxValue;
            if (order == 0)
            {
                match.Enemies.Add(upper);
                match.Enemies.Add(lower);
            }
            else
            {
                match.Enemies.Add(lower);
                match.Enemies.Add(upper);
            }
            // 몸이 틈의 동쪽 끝(x = 528)을 다 지난 적이 나올 때까지 진행한다.
            Fixed through = Fixed.FromInt(528) + EnemyDefinition.Grunt.Radius;
            Enemy? first = null;
            for (long tick = 0; tick < Rules.ToTicks(20); tick++)
            {
                match.Step();
                if (lower.Position.X > through)
                {
                    first = lower;
                    break;
                }
                if (upper.Position.X > through)
                {
                    first = upper;
                    break;
                }
            }
            Check(first != null, $"목록 차례 {order}: 20초 안에 아무도 틈을 지나지 못했습니다");
            Check(first == lower, $"목록 차례 {order}: id가 작은 적(아래)이 아니라 id가 큰 적(위)이 먼저 틈을 지났습니다");
        }
    }

    private static void GapCrowds()
    {
        // 틈 앞에 적이 셋 넘게 몰리면 길을 내주는 일이 뒤로 이어져야 한다. 틈 어귀의 적이 모서리를 끼고 돌려면 옆의 적이 비켜나야 하고,
        // 그 적이 비켜나려면 그 뒤에 붙은 적도 비켜나야 한다. 가려는 쪽만 보고 길을 내주면 뒤의 적이 비켜날 길을 막아 셋이 함께 멈춘다.
        MissionLayout layout = GapLayout();
        EnemyDefinition grunt = EnemyDefinition.Grunt;
        EnemyDefinition breaker = EnemyDefinition.Breaker;
        EnemyDefinition warden = EnemyDefinition.Warden;

        // 철위병 셋이 위, 가운데, 아래에서 함께 온다.
        Match column = GapMatch(layout);
        List<Enemy> three = Crowd(column, new EnemyDefinition[] { warden, warden, warden }, new int[] { 420, 420, 420 }, new int[] { 200, 312, 424 });
        Enemy? late;
        bool reached = AllReach(column, three, 40, out late);
        Check(reached, $"철위병 셋: 틈 앞에서 멈췄습니다({late?.Position})");

        // 종류가 섞인 넷이 틈 위아래에 두 겹으로 선다.
        Match mixed = GapMatch(layout);
        List<Enemy> four = Crowd(mixed, new EnemyDefinition[] { breaker, grunt, warden, grunt }, new int[] { 400, 440, 400, 440 }, new int[] { 250, 290, 370, 334 });
        reached = AllReach(mixed, four, 40, out late);
        Check(reached, $"섞인 넷: 틈 앞에서 멈췄습니다({late?.Definition.Name} {late?.Position})");
    }

    // 틈 맵의 장면에서 적들이 seconds 안에 모두 틈을 지나는지 본다(몸이 틈의 동쪽 끝 x = 528을 다 지남). 대원은 캠프에 있다.
    // 틱마다 몸이 놓일 수 없는 자리에 있지 않은지도 본다.
    private static void CheckAllCross(string name, string spots, double seconds)
    {
        Match match;
        List<Enemy> crowd = GapScene(out match, 744, 312, spots);
        Enemy? behind = null;
        for (long tick = 0; tick < Rules.ToTicks(seconds); tick++)
        {
            match.Step();
            CheckBodies(match);
            behind = null;
            for (int i = 0; i < crowd.Count; i++)
            {
                if (crowd[i].Position.X <= Fixed.FromInt(528) + crowd[i].Definition.Radius)
                {
                    behind = crowd[i];
                    break;
                }
            }
            if (behind == null)
            {
                return;
            }
        }
        Check(false, $"{name}: {seconds}초가 지나도 {behind?.Definition.Name}가 틈을 지나지 못하고 {behind?.Position}에 있습니다");
    }

    private static void GapRushes()
    {
        // 한 칸 틈 앞에 여섯에서 여덟이 한꺼번에 몰린다. 틈 어귀의 적이 지나가려면 옆의 적이 비켜나야 하고, 그 적이 비켜나려면
        // 그 뒤에 붙은 적도 비켜나야 한다. 길을 내주는 일이 뒤로 이어지지 않으면 몇이 틈 서쪽에 남는다.
        // 2026-11-14에 아무 자리에 놓은 300판 가운데, 길을 내주며 물러나는 쪽을 뒤의 적이 보지 않게 바꿨을 때(앞선 적이 가려는
        // 쪽만 봄) 틈 서쪽에 적이 남은 판에서 골랐다. 지금은 셋 모두 9.1초 안에 지나간다. 고치기 전에는 여덟이 몰린 200판 가운데
        // 191판에서 틈을 지나지 못한 적이 남았다.
        CheckAllCross("여섯", "b:407,490 g:259,377 w:295,469 b:116,135 w:302,232 w:427,77", 20);
        CheckAllCross("여덟(가)", "w:170,384 g:383,346 g:302,340 w:199,486 w:122,227 w:128,471 g:140,418 b:323,99", 20);
        CheckAllCross("여덟(나)", "g:368,443 g:227,412 b:80,257 w:247,134 b:215,217 w:265,260 w:189,367 b:111,178", 20);
    }

    private static void SingleFile()
    {
        // 틈과 대원이 한 줄(y = 312)에 있고, 적들이 그 줄을 따라 줄지어 틈을 지난다. 맨 앞의 적이 대원에게 닿아 서면 뒤의 적은
        // 그 적을 정면으로 밀게 된다. 정면에서는 끼고 돌 방향이 없어, 예전에는 뒤의 적들이 맨 앞의 적 뒤에 한 줄로 선 채 대원을
        // 둘러싸지 못했다. 다른 적의 몸에 정면으로 막히면 옆으로 돌아간다.
        MissionLayout layout = GapLayout();
        EnemyDefinition grunt = EnemyDefinition.Grunt;
        Match match = GapMatch(layout);
        List<Enemy> file = Crowd(match, new EnemyDefinition[] { grunt, grunt, grunt, grunt }, new int[] { 380, 320, 260, 200 }, new int[] { 312, 312, 312, 312 });
        Enemy? late;
        bool reached = AllReach(match, file, 20, out late);
        Check(reached, $"병사 넷: 대원을 둘러싸지 못하고 줄을 섰습니다({late?.Position})");

        Match mixed = GapMatch(layout);
        EnemyDefinition[] kinds = new EnemyDefinition[] { grunt, EnemyDefinition.Breaker, EnemyDefinition.Warden, grunt };
        List<Enemy> line = Crowd(mixed, kinds, new int[] { 300, 240, 180, 120 }, new int[] { 312, 312, 312, 312 });
        reached = AllReach(mixed, line, 20, out late);
        Check(reached, $"섞인 넷: 대원을 둘러싸지 못하고 줄을 섰습니다({late?.Definition.Name} {late?.Position})");
    }

    private static void GivesWayOnlyToMovers()
    {
        // 길은 가까이에서 움직이는 앞선 적에게만 내준다. 더 갈 수 없어 기다리는 적에게는 내주지 않는다.
        // 장면마다 그 뒤의 "지금"은 고친 코드에서 모두가 공격 거리 안에 든 때다(처음 자리를 흔든 열두 가지 가운데 가장 늦은 때).

        // 대원에게 다 온 적은 기다리는 적이다. 셋이 대원 서쪽에 붙어 선다(지금 4.2초). 다 온 적에게도 길을 내주면
        // 뒤에 온 둘이 먼저 붙은 분쇄자에게서 물러나, 공격 거리 밖(거리 87)과 그 언저리(거리 70)에 선다.
        CheckSurrounds("다 온 적", 744, 312, "b:396,296 g:434,440 b:437,351", 6.5);

        // 다 온 적 뒤에 막혀 선 적도 기다리는 적이다. 대원이 틈 남동쪽의 벽 가까이에 있다(지금 5.1초). 그 적에게도 길을 내주면
        // 병사 둘이 물러나 공격 거리 밖(거리 101)과 그 언저리(거리 70)에 선다.
        CheckSurrounds("다 온 적 뒤에 선 적", 581, 405, "w:313,320 g:304,98 g:246,446", 8);

        // 기다리는지를 아예 보지 않으면, 대원 앞에 모이던 병사 셋 가운데 하나가 공격 거리 밖(거리 92)으로 밀려난다(지금 4.0초).
        CheckSurrounds("대원 앞에 모이는 셋", 590, 307, "g:236,434 g:411,335 g:425,420", 6);

        // 길을 내주는 세기는 몸이 닿기 조금 전부터 가까울수록 세진다(지금 9.3초). 가까이 오자마자 가장 세게 물러나면
        // 다섯 가운데 철위병 하나가 들어설 자리를 놓쳐 공격 거리 밖(거리 78)에 선다.
        CheckSurrounds("가까울수록 세게", 744, 312, "b:335,457 b:251,264 g:206,144 w:258,154 w:253,530", 14);
    }

    private static void FollowsInLine()
    {
        // 틈과 대원이 한 줄(y = 312)에 있고, 느린 적이 앞서고 빠른 병사들이 그 줄로 뒤따른다. 뒤따르는 적은 앞의 적이 가까워지면
        // 제 갈 길을 덜 가다가, 가려는 방향과 물러나는 방향이 거의 맞서는 거리에서는 그 틱에 서 있는다.
        // 서 있지 않고 제 빠르기로 움직이면 한 틱은 다가가고 다음 틱은 물러나기를 되풀이한다(셋이 가는 장면에서 72틱).
        string[] lines = new string[]
        {
            "w:200,312 g:150,312 g:100,312",
            "w:230,312 g:180,312 g:130,312 g:80,312",
            "b:200,312 g:150,312 g:100,312",
        };
        Fixed stepped = Fixed.FromDouble(0.5);
        Fixed same = Fixed.FromDouble(0.3);
        for (int s = 0; s < lines.Length; s++)
        {
            Match match;
            List<Enemy> crowd = GapScene(out match, 744, 312, lines[s]);
            FixedVector[] last = new FixedVector[crowd.Count];
            FixedVector[] older = new FixedVector[crowd.Count];
            for (int i = 0; i < crowd.Count; i++)
            {
                last[i] = crowd[i].Position;
                older[i] = crowd[i].Position;
            }
            // 움직였는데 두 틱 전 자리로 돌아와 있으면 다가갔다 물러난 것이다.
            int rocked = 0;
            for (long tick = 1; tick <= Rules.ToTicks(16); tick++)
            {
                match.Step();
                CheckBodies(match);
                for (int i = 0; i < crowd.Count; i++)
                {
                    FixedVector position = crowd[i].Position;
                    if (tick > 2 && FixedVector.Distance(position, last[i]) > stepped && FixedVector.Distance(position, older[i]) < same)
                    {
                        rocked++;
                    }
                    older[i] = last[i];
                    last[i] = position;
                }
            }
            Check(rocked == 0, $"줄 {s + 1}({lines[s]}): 뒤따르는 적이 다가갔다 물러나기를 {rocked}틱 되풀이했습니다");
        }
    }

    private static void AheadOrder()
    {
        // 앞선 적은 대원까지 가는 길이 더 짧은 적이고, 길의 칸 수가 같으면 대원에게 더 가까운 적이다. 적 목록의 차례와는 관계없다.

        // 같은 칸의 적들 사이에서는 대원에게 더 가까운 적이 앞선다(지금 8.1초). 길의 칸 수만 보면 같은 칸에서는 id 차례가 되어,
        // 앞에 있는 적이 뒤에 있는 적에게 길을 내주기도 한다. 그러면 철위병 하나가 공격 거리 밖(거리 81)에 선다.
        CheckSurrounds("같은 칸에서는 가까운 적부터", 708, 328, "w:182,246 w:378,513 w:294,109 g:349,196", 12.5);

        // 대원이 틈에서 멀리 북동쪽에 있어, 벽 서쪽의 적에게는 곧은 거리와 길의 거리가 어긋난다. 틈에 더 가까운 적이 길이 더 짧다.
        // 곧은 거리만 보면 틈에서 멀지만 대원 쪽 벽에 가까운 적이 앞서, 틈 어귀의 적이 그 적에게 길을 내준다.
        // 그러면 넷 가운데 철위병 하나가 공격 거리 밖(거리 81)에 선다(지금은 8.8초에 넷이 모두 든다).
        CheckSurrounds("곧은 거리보다 길의 거리", 789, 176, "w:199,196 b:297,291 w:358,265 g:230,280", 13.5);

        // 이 장면은 가장 멀리서 출발하는 철위병이 목록의 맨 앞이고, 가장 먼저 닿는 병사가 맨 뒤다(지금 8.2초).
        // 목록 차례대로 앞선다고 치면 먼저 온 적들이 뒤에 오는 철위병에게 길을 내주려 물러나, 철위병 하나가 공격 거리 밖에 선다.
        CheckSurrounds("목록 차례와 다른 앞선 차례", 596, 234, "w:335,518 w:166,539 g:318,160", 12.5);
    }

    // 장면의 적들이 seconds초 뒤에 가만히 서 있는지만 본다(모두 공격 거리 안에 드는지는 보지 않는다).
    private static void CheckStands(string name, Match match, List<Enemy> crowd, double seconds)
    {
        long total = Rules.ToTicks(seconds);
        long settled = total - Rules.ToTicks(3);
        Fixed[] travelled = new Fixed[crowd.Count];
        FixedVector[] before = new FixedVector[crowd.Count];
        for (long tick = 1; tick <= total; tick++)
        {
            for (int i = 0; i < crowd.Count; i++)
            {
                before[i] = crowd[i].Position;
            }
            match.Step();
            CheckBodies(match);
            for (int i = 0; i < crowd.Count; i++)
            {
                if (tick > settled)
                {
                    travelled[i] += FixedVector.Distance(crowd[i].Position, before[i]);
                }
            }
        }
        for (int i = 0; i < crowd.Count; i++)
        {
            Check(travelled[i] < Fixed.One, $"{name}: {crowd[i].Definition.Name}({crowd[i].Position})가 자리를 잡은 뒤에도 3초 동안 {travelled[i]}만큼 움직였습니다");
        }
    }

    private static void SidestepSettles()
    {
        // 다른 적의 몸에 정면으로 막힌 적은 옆으로 돌아 들어가고, 더 갈 수 없으면 그 자리에 가만히 선다.

        // 도는 쪽은 쫓는 대원 쪽에서 보아 치우친 쪽이다. 생성 맵(시드 174)에서 대원이 벽 가까이에 있고, 병사가 먼저 붙은 뒤
        // 분쇄자 셋이 온다. 셋째 분쇄자는 앞의 둘 뒤에서 들어설 자리가 없어 공격 거리 밖에 선다. 이런 자리에서는 대원이 보여도
        // 몸 통과 판단이 한 걸음 차이로 갈려, 가려는 방향이 직진과 흐름장 사이를 오간다. 도는 쪽을 가려는 방향이나 이번 틱의
        // 이동으로 고르면 도는 쪽이 틱마다 뒤집혀, 그 분쇄자가 제자리에서 떤다(흔든 열두 가지 가운데 열에서 열하나).
        Match walled;
        List<Enemy> four = MapScene(out walled, 174, 2616, 888, "b:2561,645 b:2568,713 g:2601,912 b:2533,597");
        CheckStands("대원 쪽으로 도는 분쇄자", walled, four, 30);

        // 두 몸에 함께 막히면 더 깊이 겹친 몸을 끼고 돈다(지금 8.2초). 깊이를 보지 않고 아무 몸이나 고르면
        // 분쇄자 하나가 앞줄 뒤에서 돌아 들어가지 못하고 공격 거리 밖(거리 82)에 선다.
        CheckSurrounds("두 몸에 막힌 분쇄자", 744, 312, "b:239,495 g:397,314 g:411,67 g:237,132 b:240,80", 12.5);

        // 대원의 몸은 옆으로 돌지 않는다. 틈과 대원이 한 줄에 있고 셋이 줄지어 온다(지금 4.6초). 대원에게 닿은 적은 다 온 것이다.
        // 대원의 몸까지 옆으로 돌면, 대원에게 닿은 적이 대원 둘레를 계속 돈다.
        CheckSurrounds("대원에게 닿으면 멈춤", 744, 312, "w:397,309 g:334,314 g:270,314", 7);

        // 가로와 세로를 따로 움직여서는 못 가도, 두 몸 사이를 비스듬히 지나는 자리가 비어 있으면 그대로 간다(지금 6.3초).
        // 막은 것을 끼고 도는 길만 찾으면, 대원 앞에 모인 다섯 가운데 앞의 몸들 사이를 빠져나가지 못한 적이 공격 거리 밖에 선다.
        CheckSurrounds("두 몸 사이로 비스듬히", 601, 277, "g:186,86 b:275,502 g:232,452 g:112,554 g:109,411", 9.5);
    }

    private static void CrowdSettles()
    {
        // 대원에게 닿은 적과 그 뒤에서 기다리는 적은 가만히 서 있어야 한다. 길을 내주는 규칙과 옆으로 도는 규칙은 틱마다 방향을
        // 다시 정하므로, 잘못 맞물리면 한 틱은 비키고 다음 틱은 되돌아오기를 되풀이하며 제자리에서 떤다.
        // 적 여섯이 틈을 지나 대원을 둘러싼 뒤 3초 동안, 어느 적도 1 넘게 움직이지 않는다.
        MissionLayout layout = GapLayout();
        EnemyDefinition grunt = EnemyDefinition.Grunt;
        EnemyDefinition breaker = EnemyDefinition.Breaker;
        EnemyDefinition warden = EnemyDefinition.Warden;
        Match match = GapMatch(layout);
        EnemyDefinition[] kinds = new EnemyDefinition[] { grunt, breaker, warden, grunt, breaker, warden };
        List<Enemy> crowd = Crowd(match, kinds, new int[] { 380, 320, 250, 180, 380, 300 }, new int[] { 312, 250, 312, 380, 420, 180 });
        for (long tick = 0; tick < Rules.ToTicks(40); tick++)
        {
            match.Step();
            CheckBodies(match);
        }
        Fixed[] travelled = new Fixed[crowd.Count];
        for (long tick = 0; tick < Rules.ToTicks(3); tick++)
        {
            FixedVector[] before = new FixedVector[crowd.Count];
            for (int i = 0; i < crowd.Count; i++)
            {
                before[i] = crowd[i].Position;
            }
            match.Step();
            for (int i = 0; i < crowd.Count; i++)
            {
                travelled[i] += FixedVector.Distance(crowd[i].Position, before[i]);
            }
        }
        for (int i = 0; i < crowd.Count; i++)
        {
            Check(travelled[i] < Fixed.One, $"{crowd[i].Definition.Name}({crowd[i].Position}): 자리를 잡은 뒤에도 3초 동안 {travelled[i]}만큼 움직였습니다");
        }
    }

    private static void WaitersBehindAttackers()
    {
        // 적이 행동하는 장면이다. 대원이 틈 북쪽의 벽 가까이에 서 있고 다섯이 온다. 먼저 닿은 적은 예고하고 공격하는 동안 그 자리에
        // 서 있으므로, 나머지는 그 뒤에 막혀 공격 거리 밖에서 기다린다. 기다리는 적은 가만히 서 있어야 한다.
        // 행동 중인 적 뒤에 선 적에게도 길을 내주면, 뒤의 적들이 서로 비켜 주고 다시 다가가기를 되풀이하며 떠돈다. 2026-11-14에
        // 처음 자리를 ±2씩 흔든 열두 가지로 재니, 그렇게 바꾼 코드는 열두 가지 모두에서 기다리는 적 서넛이 떠돌았고 지금 코드는 모두 가만히 섰다.
        Match match;
        List<Enemy> crowd = GapScene(out match, 581, 244, "w:199,196 b:297,291 w:358,265 g:230,280 b:297,152");
        for (int i = 0; i < crowd.Count; i++)
        {
            crowd[i].NextActionTick = 0;
        }
        // 대원은 30초 동안 맞기만 하므로 쓰러지지 않게 체력을 넉넉히 둔다.
        Player player = match.Players[0];
        player.MaxHp = 1000000;
        player.Hp = 1000000;
        long total = Rules.ToTicks(30);
        long settled = total - Rules.ToTicks(3);
        Fixed[] travelled = new Fixed[crowd.Count];
        FixedVector[] before = new FixedVector[crowd.Count];
        bool acted = false;
        for (long tick = 1; tick <= total; tick++)
        {
            for (int i = 0; i < crowd.Count; i++)
            {
                before[i] = crowd[i].Position;
            }
            match.Step();
            CheckBodies(match);
            for (int i = 0; i < crowd.Count; i++)
            {
                if (crowd[i].Action != null)
                {
                    acted = true;
                }
                if (tick > settled)
                {
                    travelled[i] += FixedVector.Distance(crowd[i].Position, before[i]);
                }
            }
        }
        Check(player.State == "alive", "대원이 쓰러져 검사 조건이 아닙니다");
        Check(acted, "행동한 적이 없어 검사 조건이 아닙니다");
        int waiting = 0;
        for (int i = 0; i < crowd.Count; i++)
        {
            Enemy enemy = crowd[i];
            if (InReach(match, enemy))
            {
                continue;
            }
            waiting++;
            Check(travelled[i] < Fixed.One, $"공격 거리 밖에서 기다리는 {enemy.Definition.Name}({enemy.Position})가 마지막 3초 동안 {travelled[i]}만큼 움직였습니다");
        }
        Check(waiting >= 2, $"기다리는 적이 {waiting}뿐이라 검사 조건이 아닙니다");
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
