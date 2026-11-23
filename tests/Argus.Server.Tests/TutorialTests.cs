using System.Text.Json;
using Argus.Server.Game;
using Argus.Server.Networking;
using Argus.Server.Recording;
using static TestTools;

// 튜토리얼 훈련장의 장면이다(이슈 #36, 2026-11-24. 처음 온 사람이 게임을 모른다는 사용자 말).
// 훈련장에는 늘 같은 상성만 예고하고 제자리에 서는 훈련용 병사 셋(타격·방어·잡기, 체력 3)과 캠프 보급, 처음부터 열린 탈출 지점이 있다.
internal static class TutorialTests
{
    public static void Register(List<TestCase> tests)
    {
        tests.Add(new TestCase("The tutorial ground has three drill grunts that strike, block and grab from left to right, hold their place and have 3 health, and an open extraction", TutorialGround));
        tests.Add(new TestCase("A drill grunt only ever telegraphs its own kind and never walks, even with a player beside it", DrillHoldsAndRepeats));
        tests.Add(new TestCase("A drill grunt falls to the winning answer at once, but a draw only costs it one health", DrillFallsToTheWinningAnswer));
        tests.Add(new TestCase("No reinforcements come to the tutorial, even after the drill grunts fall", NoReinforcements));
        tests.Add(new TestCase("The tutorial room opens without the test setting, and its drill grunts survive the recording format", TutorialRoom));
        tests.Add(new TestCase("The state summary tells apart enemies that differ only in their drill kind, holding or maximum health", DrillStateHash));
        tests.Add(new TestCase("A recorded tutorial replays to the same state, drill grunts and no reinforcements included", TutorialReplays));
    }

    // 튜토리얼 규칙이다(RoomHost가 튜토리얼 방에 쓰는 것과 같다). 대원 체력만 검사마다 정한다.
    private static Rules TutorialRules(double playerHealth)
    {
        return new Rules { Reinforcements = false, PlayerHealth = playerHealth };
    }

    // 캠프에 착지한 대원이 있는 튜토리얼 방이다. 마나는 가득이다.
    private static Pad TutorialPad(double playerHealth)
    {
        Fixture f = new Fixture(TutorialRules(playerHealth), MissionLayout.CreateTutorial());
        f.Player.Mana = 24;
        return new Pad(f);
    }

    // 대원을 그 훈련용 병사의 왼쪽 40에 세운다. 조준은 오른쪽(병사 쪽)이다. 병사가 행동을 고르는 거리(75) 안이다.
    private static void StandBeside(Pad pad, Enemy drill)
    {
        pad.F.Player.Position = drill.Position - FixedVector.FromInt(40, 0);
        pad.Aim = 0;
    }

    // 병사가 새 행동을 예고하기 시작할 때까지 대원이 아무것도 누르지 않고 기다린다. 기다린 틱 수가 한도를 넘으면 실패한다.
    private static EnemyAction WaitForTelegraph(Pad pad, Enemy drill, int previousId)
    {
        for (int i = 0; i < 300; i++)
        {
            if (drill.Action != null && drill.Action.Id != previousId)
            {
                return drill.Action;
            }
            pad.Run(0, 1);
        }
        throw new Exception("훈련용 병사가 10초 동안 예고하지 않았습니다");
    }

    private static void TutorialGround()
    {
        MissionLayout layout = MissionLayout.CreateTutorial();
        Equal(layout.Facilities.Count, 0);
        Equal(layout.InitialEnemySpots.Count, 3);
        string[] kinds = new string[] { "strike", "block", "channel" };
        for (int i = 0; i < 3; i++)
        {
            EnemySpot spot = layout.InitialEnemySpots[i];
            Equal(spot.Kind, EnemyDefinition.Grunt);
            Equal(spot.Drill, kinds[i]);
            Check(spot.Holds, $"훈련용 병사 {i + 1}이 제자리에 서지 않습니다");
            Equal(spot.Health, MissionLayout.TutorialDrillHealth);
            if (i > 0)
            {
                // 왼쪽(캠프 쪽)부터 차례로 선다.
                Check(spot.Position.X > layout.InitialEnemySpots[i - 1].Position.X, "훈련용 병사가 왼쪽부터 타격·방어·잡기 차례가 아닙니다");
            }
        }
        Match match = new Match("TUTOR1", TutorialRules(6), SeededRandom.SeedFromNumber(1), layout);
        Equal(match.Enemies.Count, 3);
        for (int i = 0; i < 3; i++)
        {
            Enemy drill = match.Enemies[i];
            Equal(drill.FixedSkill!.Kind, kinds[i]);
            Check(drill.Holds, $"훈련용 병사 {i + 1}이 제자리에 서지 않습니다");
            Near(drill.Hp, MissionLayout.TutorialDrillHealth);
            Equal(drill.MaxHp, MissionLayout.TutorialDrillHealth);
        }
        // 시설이 없어 탈출은 처음부터 열려 있다.
        Check(match.ObjectivesComplete, "튜토리얼의 탈출이 처음부터 열려 있지 않습니다");
        // 배치 검사는 그 종류에 없는 상성과 1보다 작은 체력을 거절한다. 그래서 검사를 통과한 배치로는 언제나 방을 만들 수 있다.
        Throws<ArgumentException>(() => WithDrill("dash", 3));
        Throws<ArgumentException>(() => WithDrill("strike", 0));
        WithDrill("strike", 1);
        // 보통 배치의 적은 훈련 설정이 없다.
        Match ordinary = new Match("TEST01", new Rules(), 73);
        for (int i = 0; i < ordinary.Enemies.Count; i++)
        {
            Check(ordinary.Enemies[i].FixedSkill == null && !ordinary.Enemies[i].Holds, "보통 적에 훈련 설정이 붙었습니다");
            Equal(ordinary.Enemies[i].MaxHp, ordinary.Enemies[i].Definition.Health);
        }
    }

    // 튜토리얼 배치에서 첫 훈련용 병사만 바꾼 배치다. 배치의 생성자가 검사한다.
    private static MissionLayout WithDrill(string drill, int health)
    {
        MissionLayout tutorial = MissionLayout.CreateTutorial();
        EnemySpot[] spots = new EnemySpot[tutorial.InitialEnemySpots.Count];
        for (int i = 0; i < spots.Length; i++)
        {
            spots[i] = tutorial.InitialEnemySpots[i];
        }
        spots[0] = new EnemySpot(spots[0].Position, spots[0].Kind, drill, true, health);
        FixedVector[] facilities = new FixedVector[0];
        SupplySpot[] supplies = new SupplySpot[tutorial.Supplies.Count];
        for (int i = 0; i < supplies.Length; i++)
        {
            supplies[i] = tutorial.Supplies[i];
        }
        byte[] tiles = new byte[tutorial.Tiles.Count];
        for (int i = 0; i < tiles.Length; i++)
        {
            tiles[i] = tutorial.Tiles[i];
        }
        return new MissionLayout(tutorial.Columns, tutorial.Rows, tiles, tutorial.Camp, tutorial.Extraction, facilities, supplies, spots, tutorial.Reinforcements);
    }

    private static void DrillHoldsAndRepeats()
    {
        // 대원은 맞아도 쓰러지지 않게 체력을 넉넉히 둔다. 아무것도 누르지 않고 20초 동안 타격 병사 곁에 선다.
        Pad pad = TutorialPad(1000);
        Enemy strike = pad.F.Match.Enemies[0];
        Enemy block = pad.F.Match.Enemies[1];
        Enemy channel = pad.F.Match.Enemies[2];
        FixedVector[] places = new FixedVector[] { strike.Position, block.Position, channel.Position };
        StandBeside(pad, strike);
        HashSet<int> seen = new HashSet<int>();
        for (int i = 0; i < 20 * Rules.TicksPerSecond; i++)
        {
            pad.Run(0, 1);
            if (strike.Action != null)
            {
                seen.Add(strike.Action.Id);
                Equal(strike.Action.Skill.Kind, "strike");
            }
            // 먼 두 병사는 행동하지 않는다(행동을 고르는 거리 밖이다).
            Check(block.Action == null && channel.Action == null, "먼 훈련용 병사가 행동했습니다");
            Equal(strike.Position, places[0]);
            Equal(block.Position, places[1]);
            Equal(channel.Position, places[2]);
        }
        // 20초 동안 예고를 여러 번 했다(준비 동작 두 배라 한 번에 3초 남짓).
        Check(seen.Count >= 4, $"20초 동안 예고가 {seen.Count}번뿐입니다");
        // 대원이 멀어도 서 있다. 보통 병사라면 대원에게 걸어온다.
        pad.F.Player.Position = pad.F.Match.Layout.Camp;
        pad.Run(0, 5 * Rules.TicksPerSecond);
        Equal(strike.Position, places[0]);
        // 스냅샷의 최대 체력은 배치가 정한 값이다.
        StandBeside(pad, strike);
        pad.Run(0, 1);
        using JsonDocument snapshot = JsonDocument.Parse(Snapshot.Create(pad.F.Match, pad.F.Player, RoomHost.Json));
        JsonElement enemies = snapshot.RootElement.GetProperty("enemies");
        bool found = false;
        for (int i = 0; i < enemies.GetArrayLength(); i++)
        {
            if (enemies[i].GetProperty("id").GetInt32() == strike.Id)
            {
                found = true;
                Equal(enemies[i].GetProperty("maxHp").GetInt32(), MissionLayout.TutorialDrillHealth);
            }
        }
        Check(found, "곁의 훈련용 병사가 스냅샷에 없습니다");
    }

    private static void DrillFallsToTheWinningAnswer()
    {
        Pad pad = TutorialPad(6);
        Enemy strike = pad.F.Match.Enemies[0];
        StandBeside(pad, strike);
        // 비김: 타격을 예고할 때 같은 타격을 짧게 낸다. 기운이 끝나 나간 장판이 병사의 타격 기운에 닿아 서로 1을 잃는다.
        EnemyAction first = WaitForTelegraph(pad, strike, -1);
        pad.Tap(1);
        for (int i = 0; i < Rules.TicksPerSecond && strike.Hp >= MissionLayout.TutorialDrillHealth; i++)
        {
            pad.Run(0, 1);
        }
        Near(strike.Hp, MissionLayout.TutorialDrillHealth - 1);
        Near(pad.F.Player.Hp, 5);
        Check(pad.F.Match.Enemies.Contains(strike), "비긴 훈련용 병사가 쓰러졌습니다. 체력 3이면 비김 한 번에는 남아야 합니다");
        // 이기는 답: 다음 타격 예고에 받아치기(방어)를 낸다. 예고 장판 안에서 이기는 기운이라 그 순간 완벽 대응이고,
        // 체력이 남아 있어도 쓰러진다. 대원은 다치지 않는다.
        double hp = pad.F.Player.Hp;
        WaitForTelegraph(pad, strike, first.Id);
        pad.Press(2);
        for (int i = 0; i < Rules.TicksPerSecond && pad.F.Match.Enemies.Contains(strike); i++)
        {
            pad.Run(2, 1);
        }
        Check(!pad.F.Match.Enemies.Contains(strike), "이기는 기술로 받아친 훈련용 병사가 쓰러지지 않았습니다");
        Near(pad.F.Player.Hp, hp);
    }

    private static void NoReinforcements()
    {
        // 튜토리얼 규칙은 증원을 끈다. 대원이 캠프에 선 채 1분이 지나도 처음의 셋뿐이다.
        Fixture tutorial = new Fixture(TutorialRules(1000), MissionLayout.CreateTutorial());
        Advance(tutorial.Match, 60);
        Equal(tutorial.Match.Enemies.Count, 3);
        // 셋이 모두 쓰러져 자리가 나도 오지 않는다.
        tutorial.Match.Enemies.Clear();
        Advance(tutorial.Match, 60);
        Equal(tutorial.Match.Enemies.Count, 0);
        // 견주기: 같은 배치에 증원을 켜면 그 사이에 온다.
        Fixture reinforced = new Fixture(new Rules { PlayerHealth = 1000 }, MissionLayout.CreateTutorial());
        reinforced.Match.Enemies.Clear();
        Advance(reinforced.Match, 60);
        Check(reinforced.Match.Enemies.Count > 0, "증원을 켠 방에도 증원이 오지 않았습니다. 이 검사가 아무것도 가리지 못합니다");
    }

    private static void TutorialRoom()
    {
        // 튜토리얼은 운영에서 쓰므로 검사용 설정(AllowHandmade) 없이 만들 수 있다. 손으로 만든 맵은 여전히 막힌다.
        using RoomHost host = NewHost();
        EntryFailure failure;
        Check(host.Create(new EntryRequest("pilot", null, EntryRequest.HandmadeLayout), null, out failure) == null);
        Equal(failure, EntryFailure.LayoutUnavailable);
        Guest guest = host.Create(new EntryRequest("pilot", null, EntryRequest.TutorialLayout))!;
        (Room room, Player player, Peer peer) = host.Attach(guest.Room, guest.Token)!.Value;
        Check(!room.Match.Rules.Reinforcements, "튜토리얼 방에 증원이 켜져 있습니다");
        Check(!room.Match.Rules.AllowEliteEnemies, "튜토리얼 방에 엘리트가 나옵니다");
        Equal(room.Match.Rules.EnemyWindupMultiplier, 2.0);
        MissionLayout reference = MissionLayout.CreateTutorial();
        string made = JsonSerializer.Serialize(LayoutRecord.From(room.Match.Layout), RoomHost.Json);
        Equal(made, JsonSerializer.Serialize(LayoutRecord.From(reference), RoomHost.Json));
        Equal(room.Match.Enemies.Count, 3);
        host.Detach(room, player, peer);
        // 기록 형식으로 적었다 되읽어도 훈련 설정이 그대로다. 재생은 이 배치로 방을 다시 만든다.
        LayoutRecord record = JsonSerializer.Deserialize<LayoutRecord>(made, RoomHost.Json)!;
        MissionLayout back = record.ToLayout();
        for (int i = 0; i < 3; i++)
        {
            Equal(back.InitialEnemySpots[i].Drill, reference.InitialEnemySpots[i].Drill);
            Equal(back.InitialEnemySpots[i].Holds, reference.InitialEnemySpots[i].Holds);
            Equal(back.InitialEnemySpots[i].Health, reference.InitialEnemySpots[i].Health);
        }
        // 보통 배치의 글에는 훈련 설정이 나오지 않는다(예전 기록과 같은 글이다).
        string ordinary = JsonSerializer.Serialize(LayoutRecord.From(MissionLayout.CreateHandmade()), RoomHost.Json);
        Check(!ordinary.Contains("drill") && !ordinary.Contains("holds") && !ordinary.Contains("health"), "보통 배치의 글에 훈련 설정이 들어갔습니다");
    }

    // 기록을 메모리에 모은다(RecordingTests의 것과 같다).
    private sealed class MemoryRecorder : IMatchRecorder
    {
        public List<MatchRecord> Records { get; } = new List<MatchRecord>();

        public void Write(MatchRecord record)
        {
            Records.Add(record);
        }
    }

    private static void TutorialReplays()
    {
        // 서버의 튜토리얼 방처럼 만들고 처음부터 기록한다. 새 대원은 마나가 0이라, 캠프 보급 상자로 가 마나를 채운 뒤
        // 타격 병사 곁에 서고, 병사가 예고할 때마다 받아치기(방어)를 누른다. 40초 동안 증원이 오지 않은 채 첫 병사가 쓰러진다.
        Rules rules = new Rules { Reinforcements = false };
        byte[] seed = SeededRandom.SeedFromNumber(5);
        MissionLayout layout = MissionLayout.CreateTutorial();
        Match match = new Match("TUTOR1", rules, seed, layout);
        MemoryRecorder recorder = new MemoryRecorder();
        match.Recorder = recorder;
        Player player = match.Join("p", "pilot")!;
        Check(match.Deploy(player, layout.Camp.X.ToDouble(), layout.Camp.Y.ToDouble()));
        Enemy strike = match.Enemies[0];
        FixedVector box = layout.Supplies[0].Position;
        FixedVector post = strike.Position - FixedVector.FromInt(40, 0);
        int answered = -1;
        long ticks = Rules.ToTicks(40);
        for (long tick = 0; tick < ticks; tick++)
        {
            // 마나가 없으면 보급 상자로, 있으면 병사 곁의 자리로 걷는다. 닿으면 선다.
            FixedVector goal = post;
            if (player.Mana == 0)
            {
                goal = box;
            }
            double dx = (goal - player.Position).X.ToDouble();
            double dy = (goal - player.Position).Y.ToDouble();
            double length = Math.Sqrt(dx * dx + dy * dy);
            double moveX = 0;
            double moveY = 0;
            if (player.State == "alive" && length > 4)
            {
                moveX = dx / length;
                moveY = dy / length;
            }
            int[] held = new int[0];
            int[] pressed = new int[0];
            if (strike.Action != null && strike.Action.Id != answered)
            {
                answered = strike.Action.Id;
                held = new int[] { 2 };
                pressed = new int[] { 2 };
            }
            match.Input(player, tick, moveX, moveY, 0, held, pressed);
            match.Step();
        }
        Check(!match.Enemies.Contains(strike), $"40초 동안 타격 병사를 쓰러뜨리지 못해 이 장면이 처치를 기록하지 않습니다(대원 {player.State}, 체력 {player.Hp}, 마나 {player.Mana})");
        Near(player.Hp, rules.PlayerHealth);
        Equal(match.Enemies.Count, 2);

        // 기록 머리는 서버처럼 JSON으로 적었다 되읽는다. 규칙(증원 끄기)과 배치(훈련 설정)가 그 글로 넘어간다.
        RecordingHeader header = new RecordingHeader();
        header.Version = "test";
        header.Room = "TUTOR1";
        header.Seed = Convert.ToHexString(seed);
        header.Rules = rules;
        header.Layout = LayoutRecord.From(layout);
        string text = JsonSerializer.Serialize(header, RecordingFormat.Json);
        RecordingHeader read = JsonSerializer.Deserialize<RecordingHeader>(text, RecordingFormat.Json)!;
        Check(!read.Rules.Reinforcements, "기록 머리를 되읽으니 증원이 켜졌습니다");
        ReplayResult result = MatchReplay.Run(read, recorder.Records);
        Check(!result.DivergedAt.HasValue, $"튜토리얼 기록이 {result.DivergedAt}틱에서 갈라졌습니다");
        Check(result.Checkpoints >= 40, $"요약값을 {result.Checkpoints}개만 비교했습니다");
        Equal(result.Match.StateHash(), match.StateHash());
    }

    private static void DrillStateHash()
    {
        // 같은 배치의 두 방은 요약이 같다. 훈련용 병사 하나의 늘 쓰는 행동, 제자리에 서기, 최대 체력 가운데 하나만 바꿔도 요약이 달라진다.
        string[] changed = new string[] { "drill", "holds", "maxHp" };
        for (int i = 0; i < changed.Length; i++)
        {
            Match a = new Match("TUTOR1", TutorialRules(6), SeededRandom.SeedFromNumber(1), MissionLayout.CreateTutorial());
            Match b = new Match("TUTOR1", TutorialRules(6), SeededRandom.SeedFromNumber(1), MissionLayout.CreateTutorial());
            Equal(a.StateHash(), b.StateHash());
            Enemy drill = b.Enemies[0];
            if (changed[i] == "drill")
            {
                drill.FixedSkill = drill.Definition.SkillOf("block");
            }
            else if (changed[i] == "holds")
            {
                drill.Holds = false;
            }
            else
            {
                drill.MaxHp = 4;
            }
            Check(a.StateHash() != b.StateHash(), $"훈련 설정({changed[i]})만 다른 두 방의 요약이 같습니다");
        }
    }
}
