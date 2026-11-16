using System.Text.Json;
using Argus.Server.Game;
using Argus.Server.Networking;
using static TestTools;

// 대시의 장면이다(docs/combat.md "대시", 2026-11-15 사용자 요청).
// 대시는 넷째 자유 칸에만 드는 상성 없는 기술이다. 누르면 걷던 쪽으로(서 있으면 조준한 쪽으로) 150을 5틱에 가고,
// 그동안에는 적의 나간 장판에 맞지 않는다. 기운도 장판도 없어 대응도 타격도 아니다.
internal static class DashTests
{
    public static void Register(List<TestCase> tests)
    {
        tests.Add(new TestCase("A dash carries the player 150 the way they were walking, or the way they aim when standing, whatever they steer afterwards", DashMoves));
        tests.Add(new TestCase("A dash stops at a wall and at an enemy body the way walking does, and strikes nothing", DashIsBlocked));
        tests.Add(new TestCase("A zone that goes out during a dash misses the dashing player for good, and only then", DashEvades));
        tests.Add(new TestCase("A dash costs mana, waits its turn behind a skill in use and does not stretch or repeat while the button stays down", DashIsASkill));
        tests.Add(new TestCase("A dash pressed again and held during a dash follows it with no gap, in movement and in what it evades", DashChains));
        tests.Add(new TestCase("Dash has no affinity, so it fits the free slot and none of the three affinity slots", DashSlot));
        tests.Add(new TestCase("The state summary tells apart dashes that differ only in direction, and the snapshot sends the dash phase and direction", DashStateAndWire));
    }

    private const int DashSlotNumber = 4;
    private static readonly long DashTicks = Rules.ToTicks(Rules.FindSkill("dash")!.Duration);

    // 넷째 칸에 대시를 든 대원이다. 마나는 가득이다.
    private static Pad DashPad()
    {
        Fixture f = new Fixture();
        f.Player.Slots = new string[] { "strike", "parry", "grab", "dash" };
        f.Player.Mana = 24;
        return new Pad(f);
    }

    private static void DashMoves()
    {
        SkillDefinition dash = Rules.FindSkill("dash")!;
        Fixed distance = Fixed.FromDouble(dash.DashDistance);
        // 걷던 쪽으로 간다. 오른쪽으로 걸으며 대시를 누르면 그 틱부터 다섯 틱 동안 150을 간다.
        // 대시하는 동안 아래로 가는 입력을 보내도 방향은 바뀌지 않는다.
        Pad walking = DashPad();
        Player player = walking.F.Player;
        FixedVector start = player.Position;
        walking.MoveX = 1;
        walking.Tap(DashSlotNumber);
        Equal(player.Actions.Count, 1);
        Equal(player.Position, start + new FixedVector(dash.DashStep, Fixed.Zero));
        walking.MoveX = 0;
        walking.MoveY = 1;
        walking.Run(0, (int)DashTicks - 1);
        Equal(player.Position, start + new FixedVector(distance, Fixed.Zero));
        // 대시가 끝난 다음 틱부터는 다시 이동 입력대로 걷는다(한 틱에 6).
        walking.Run(0, 1);
        Equal(player.Actions.Count, 0);
        Equal(player.Position, start + new FixedVector(distance, Fixed.FromInt(6)));

        // 서 있으면 조준한 쪽으로 간다. 아래(+y)를 조준하고 누른다.
        Pad standing = DashPad();
        FixedVector from = standing.F.Player.Position;
        standing.Aim = Math.PI / 2;
        standing.Tap(DashSlotNumber);
        standing.Run(0, (int)DashTicks - 1);
        Equal(standing.F.Player.Position, from + new FixedVector(Fixed.Zero, distance));

        // 걷는 방향이 있으면 조준은 쓰지 않는다. 왼쪽 위로 걸으며 아래를 조준해도 왼쪽 위로 간다. 비스듬한 방향도 길이는 같다.
        Pad diagonal = DashPad();
        FixedVector origin = diagonal.F.Player.Position;
        diagonal.MoveX = -1;
        diagonal.MoveY = -1;
        diagonal.Aim = Math.PI / 2;
        diagonal.Tap(DashSlotNumber);
        diagonal.Run(0, (int)DashTicks - 1);
        FixedVector moved = diagonal.F.Player.Position - origin;
        Check(moved.X < Fixed.Zero && moved.Y < Fixed.Zero, $"왼쪽 위로 걷던 대원의 대시가 {moved}만큼 갔습니다");
        Near(moved.Length().ToDouble(), dash.DashDistance, 0.05);
        Near(moved.X.ToDouble(), moved.Y.ToDouble(), 0.01);

        // 살살 걷던 대원도 대시는 다 간다. 이동 입력의 길이가 절반이어도(다른 클라이언트의 조이스틱) 방향만 쓴다.
        Pad slow = DashPad();
        FixedVector slowStart = slow.F.Player.Position;
        slow.MoveX = 0.5;
        slow.Tap(DashSlotNumber);
        slow.Run(0, (int)DashTicks - 1);
        Equal(slow.F.Player.Position, slowStart + new FixedVector(distance, Fixed.Zero));
    }

    private static void DashIsBlocked()
    {
        // 벽은 지나가지 못한다. 맵 왼쪽 경계(x = 48)에서 20 떨어진 곳에서 왼쪽으로 대시하면 벽 앞에 선다.
        // 몸은 4 이하의 걸음으로 나눠 움직이므로 벽에서 한 걸음 안쪽에 멈춘다.
        Pad wall = DashPad();
        Player player = wall.F.Player;
        Fixed edge = Fixed.FromInt(BattleMap.Cell) + Rules.PlayerRadius;
        player.Position = new FixedVector(edge + Fixed.FromInt(20), player.Position.Y);
        Fixed row = player.Position.Y;
        wall.MoveX = -1;
        wall.Tap(DashSlotNumber);
        wall.MoveX = 0;
        wall.Run(0, (int)DashTicks);
        Check(player.Position.X >= edge && player.Position.X < edge + Fixed.FromInt(4), $"벽 앞에 서지 않고 x = {player.Position.X}에 있습니다");
        Equal(player.Position.Y, row);

        // 적의 몸도 지나가지 못한다. 오른쪽 50에 선 병사 쪽으로 대시하면 몸이 닿기 전에 멈춘다(반지름의 합 26).
        // 대시에는 장판이 없어 병사는 다치지 않는다.
        Pad body = DashPad();
        Player runner = body.F.Player;
        Enemy soldier = Target(body.F);
        Fixed contact = soldier.Position.X - Rules.PlayerRadius - soldier.Definition.Radius;
        body.MoveX = 1;
        body.Tap(DashSlotNumber);
        body.MoveX = 0;
        body.Run(0, (int)DashTicks);
        Check(runner.Position.X <= contact && runner.Position.X > contact - Fixed.FromInt(4), $"병사 앞에 서지 않고 x = {runner.Position.X}에 있습니다(닿는 자리 {contact})");
        Near(soldier.Hp, 1);
        Equal(runner.Kills, 0);
    }

    // 오른쪽 50에 서서 대원 쪽으로 타격을 예고하는 병사다. 장판은 arrivesIn초 뒤에 나간다. 대원은 병사 쪽으로 걸어도 몸에 막혀
    // 장판 안에 남는다.
    private static Enemy Striker(Fixture f, double arrivesIn)
    {
        Enemy enemy = Target(f);
        BeginAction(f, enemy, EnemyDefinition.Grunt.Skills[0], arrivesIn);
        return enemy;
    }

    private static bool HasEffect(Match match, string kind)
    {
        for (int i = 0; i < match.Effects.Count; i++)
        {
            if (match.Effects[i].Kind == kind)
            {
                return true;
            }
        }
        return false;
    }

    private static void DashEvades()
    {
        // 서 있는 대원은 맞는다. 병사의 타격 장판이 3틱 뒤에 나가 대원을 친다.
        Pad still = DashPad();
        Striker(still.F, 0.1);
        still.Run(0, 5);
        Near(still.F.Player.Hp, still.F.Player.MaxHp - 1);

        // 장판이 나가는 틱에 대시하는 중이면 맞지 않는다. 병사 쪽으로 대시해 몸에 막히므로 대원은 장판 안에 그대로 있다.
        // 자리를 벗어나서가 아니라 대시하는 동안이라 맞지 않은 것이다. 피한 장판은 대시가 끝난 뒤에도 그 대원에게 닿지 않는다
        // (장판은 0.25초 깔려 있고 대시는 그 전에 끝난다).
        Pad dashing = DashPad();
        Player player = dashing.F.Player;
        Enemy striker = Striker(dashing.F, 0.1);
        dashing.Run(0, 1);
        dashing.MoveX = 1;
        dashing.Tap(DashSlotNumber);
        dashing.MoveX = 0;
        dashing.Run(0, 1);
        // 이 틱에 장판이 나갔다.
        Check(striker.Action != null && striker.Action.ZoneOut(dashing.F.Match.Tick), "병사의 장판이 아직 나가지 않았습니다");
        Check(player.Actions.Count == 1 && player.Actions[0].Dashing(dashing.F.Match.Tick), "대원이 대시하는 중이 아닙니다");
        Near(player.Hp, player.MaxHp);
        Check(HasEffect(dashing.F.Match, "evade"), "피한 효과가 없습니다");
        // 대시가 끝나고도 장판은 깔려 있다. 대원은 그 안에 서 있지만 다시 맞지 않는다.
        dashing.Run(0, (int)DashTicks);
        Equal(player.Actions.Count, 0);
        Check(striker.Action != null && striker.Action.ZoneOut(dashing.F.Match.Tick), "병사의 장판이 벌써 걷혔습니다");
        dashing.Run(0, 10);
        Near(player.Hp, player.MaxHp);
        // 병사는 멀쩡하다. 대시는 대응이 아니다.
        Near(striker.Hp, 1);
        Equal(player.Mana, 23);

        // 장판이 나가기 전에 대시가 끝나면 맞는다. 12틱 뒤에 나가는 장판 앞에서 바로 대시하면 5틱 만에 끝난다.
        Pad early = DashPad();
        Striker(early.F, 0.4);
        early.MoveX = 1;
        early.Tap(DashSlotNumber);
        early.MoveX = 0;
        early.Run(0, 14);
        Near(early.F.Player.Hp, early.F.Player.MaxHp - 1);

        // 이미 맞은 뒤의 대시는 되돌리지 못한다.
        Pad late = DashPad();
        Striker(late.F, 0.1);
        late.Run(0, 3);
        Near(late.F.Player.Hp, late.F.Player.MaxHp - 1);
        late.MoveX = 1;
        late.Tap(DashSlotNumber);
        late.Run(0, 8);
        Near(late.F.Player.Hp, late.F.Player.MaxHp - 1);

        // 회피는 대시 거리와 따로인 속성이다. 제자리에서 회피만 하는 기술(기운도 장판도 없음)을 쓰는 동안에도 맞지 않는다.
        // 장판이 나가기 한 틱 전에 그 기술을 쓰기 시작한 것으로 둔다.
        SkillDefinition stillSkill = new SkillDefinition("still", "none", 1, 0, 0, 0.3, 0, 0,
            plainZone: false, singleTarget: false, breaksStructures: false, around: false, dashDistance: 0, evades: true);
        Pad rooted = DashPad();
        Player stander = rooted.F.Player;
        Enemy hitter = Striker(rooted.F, 0.1);
        rooted.Run(0, 2);
        long maxAuraTicks = Rules.ToTicks(rooted.F.Match.Rules.MaxAuraSeconds);
        stander.Actions.Add(new PlayerAction(9001, stillSkill, DashSlotNumber, rooted.F.Match.Tick, maxAuraTicks));
        FixedVector stood = stander.Position;
        rooted.Run(0, 1);
        Check(hitter.Action != null && hitter.Action.ZoneOut(rooted.F.Match.Tick), "병사의 장판이 아직 나가지 않았습니다");
        rooted.Run(0, 6);
        Near(stander.Hp, stander.MaxHp);
        Equal(stander.Position, stood);
        Check(HasEffect(rooted.F.Match, "evade"), "제자리 회피의 효과가 없습니다");
    }

    private static void DashIsASkill()
    {
        // 마나가 없으면 나가지 않는다.
        Pad empty = DashPad();
        empty.F.Player.Mana = 0;
        FixedVector spot = empty.F.Player.Position;
        empty.MoveX = 1;
        empty.Tap(DashSlotNumber);
        Equal(empty.F.Player.Actions.Count, 0);
        // 대시 없이 한 틱 걸었을 뿐이다.
        Equal(empty.F.Player.Position, spot + FixedVector.FromInt(6, 0));

        // 마나 1을 쓴다. 버튼을 누르고 있어도 늦게 나가거나 길어지거나 다시 나가지 않는다. 열 틱을 누르고 있어도 150만 간다.
        Pad held = DashPad();
        Player player = held.F.Player;
        FixedVector start = player.Position;
        held.Aim = 0;
        held.Press(DashSlotNumber);
        Equal(player.Actions.Count, 1);
        Check(!player.Actions[0].Holding, "대시가 버튼을 누르고 있어 이어지는 기술로 나갔습니다");
        Equal(player.Position, start + new FixedVector(Rules.FindSkill("dash")!.DashStep, Fixed.Zero));
        held.Run(DashSlotNumber, 10);
        Equal(player.Actions.Count, 0);
        Equal(player.Position, start + FixedVector.FromInt(150, 0));
        Equal(player.Mana, 23);

        // 쓰던 기술이 끝날 때까지 기다린다. 근접 타격을 짧게 누른 뒤 대시를 누르고 있으면, 타격이 끝나는 틱에 대시가 나간다.
        Pad queued = DashPad();
        Player waiter = queued.F.Player;
        FixedVector origin = waiter.Position;
        queued.Tap(1);
        Equal(waiter.Actions[0].Skill.Id, "strike");
        queued.Press(DashSlotNumber);
        Equal(waiter.Actions[0].Skill.Id, "strike");
        Equal(waiter.Waiting.Count, 1);
        queued.RunUntilBusyLeft(DashSlotNumber, 1);
        Equal(waiter.Position, origin);
        queued.Play(DashSlotNumber, 0);
        Equal(waiter.Actions.Count, 1);
        Equal(waiter.Actions[0].Skill.Id, "dash");
        Check(waiter.Position != origin, "타격이 끝난 틱에 기다리던 대시가 움직이지 않았습니다");
        Equal(waiter.Mana, 22);
    }

    private static void DashChains()
    {
        // 쿨다운은 없다. 대시하는 중에 버튼을 다시 눌러 누르고 있으면, 앞의 대시가 끝나는 틱에 다음 대시가 나간다.
        // 두 대시 사이에 서 있는 틱이 없어 열 틱에 300을 간다. 마나는 누른 만큼 든다.
        Pad pad = DashPad();
        Player player = pad.F.Player;
        FixedVector start = player.Position;
        pad.Aim = 0;
        pad.Tap(DashSlotNumber);
        pad.Press(DashSlotNumber);
        Equal(player.Waiting.Count, 1);
        pad.Run(DashSlotNumber, (int)DashTicks - 2);
        Equal(player.Position, start + FixedVector.FromInt(150, 0));
        Equal(player.Mana, 23);
        // 다음 틱에 앞의 대시가 끝나고 기다리던 대시가 나가 바로 움직인다.
        pad.Play(DashSlotNumber, 0);
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].StartedTick, pad.F.Match.Tick);
        Equal(player.Position, start + FixedVector.FromInt(180, 0));
        Equal(player.Mana, 22);
        pad.Run(DashSlotNumber, (int)DashTicks - 1);
        Equal(player.Position, start + FixedVector.FromInt(300, 0));
        // 누르고 있기만 해서는 셋째 대시가 나가지 않는다. 다시 눌러야 한다.
        pad.Run(DashSlotNumber, 3);
        Equal(player.Actions.Count, 0);
        Equal(player.Position, start + FixedVector.FromInt(300, 0));
        Equal(player.Mana, 22);

        // 두 대시가 이어지는 바로 그 틱에 나간 장판도 피한다. 병사 쪽으로 대시해 몸에 막혀 있으므로 대원은 내내 장판 안이다.
        Pad seam = DashPad();
        Player runner = seam.F.Player;
        Enemy striker = Striker(seam.F, 0.2);
        seam.MoveX = 1;
        seam.Tap(DashSlotNumber);
        seam.Press(DashSlotNumber);
        seam.Run(DashSlotNumber, (int)DashTicks - 2);
        Check(striker.Action != null && !striker.Action.ZoneOut(seam.F.Match.Tick), "병사의 장판이 벌써 나갔습니다");
        seam.Play(DashSlotNumber, 0);
        Check(striker.Action != null && striker.Action.ZoneOut(seam.F.Match.Tick), "병사의 장판이 아직 나가지 않았습니다");
        Equal(runner.Actions.Count, 1);
        Equal(runner.Actions[0].StartedTick, seam.F.Match.Tick);
        Near(runner.Hp, runner.MaxHp);
        Check(HasEffect(seam.F.Match, "evade"), "이어지는 틱의 장판을 피한 효과가 없습니다");
        Equal(runner.Mana, 22);
    }

    private static void DashSlot()
    {
        SkillDefinition dash = Rules.FindSkill("dash")!;
        Equal(dash.Kind, "none");
        Check(dash.Evades && dash.DashDistance > 0 && dash.AuraSeconds == 0 && dash.ZoneSeconds == 0, "대시의 정의가 다릅니다");
        Check(Rules.ValidSlots(new string[] { "strike", "parry", "grab", "dash" }));
        Check(Rules.ValidSlots(new string[] { "spin", "spinblock", "spingrab", "dash" }));
        // 상성이 없어 타격·방어·잡기 칸에는 들 수 없다. 그래서 어떤 장비든 세 상성을 하나씩은 든다.
        Check(!Rules.ValidSlots(new string[] { "dash", "parry", "grab", "strike" }));
        Check(!Rules.ValidSlots(new string[] { "strike", "dash", "grab", "strike" }));
        Check(!Rules.ValidSlots(new string[] { "strike", "parry", "dash", "strike" }));
        // 대시에 기운이나 장판을 붙인 정의, 길이가 0인 대시, 음수 거리는 만들 수 없다. 기운과 장판은 회피하지 않는 대시로 본다.
        // 회피하는 대시로 보면 회피 기술의 확인도 같은 정의를 막아, 대시의 확인이 빠져도 알 수 없다.
        Throws<ArgumentOutOfRangeException>(() => new SkillDefinition("bad", "none", 1, 0.1, 0, 0.3, 0, 0,
            plainZone: false, singleTarget: false, breaksStructures: false, around: false, dashDistance: 100, evades: false));
        Throws<ArgumentOutOfRangeException>(() => new SkillDefinition("bad", "none", 1, 0, 0.1, 0.3, 0, 0,
            plainZone: false, singleTarget: false, breaksStructures: false, around: false, dashDistance: 100, evades: false));
        Throws<ArgumentOutOfRangeException>(() => new SkillDefinition("bad", "none", 1, 0, 0, 0, 0, 0,
            plainZone: false, singleTarget: false, breaksStructures: false, around: false, dashDistance: 100, evades: true));
        Throws<ArgumentOutOfRangeException>(() => new SkillDefinition("bad", "none", 1, 0, 0, 0.3, 0, 0,
            plainZone: false, singleTarget: false, breaksStructures: false, around: false, dashDistance: -1, evades: true));
        // 대시가 아니어도 회피하는 기술에는 기운과 장판을 붙일 수 없다(PR #30 리뷰 3번). 방어 기운이 도는 구르기 같은 기술이면
        // 2티어 장판 안에서 혼자 회피한 대원의 기운이 판정받지 않고 남아, 나중에 들어온 동료의 기운과 합쳐져 완벽 대응이 된다.
        Throws<ArgumentOutOfRangeException>(() => new SkillDefinition("roll", "block", 1, 0.2, 0, 0.5, 0, 0,
            plainZone: false, singleTarget: false, breaksStructures: false, around: true, dashDistance: 0, evades: true));
        Throws<ArgumentOutOfRangeException>(() => new SkillDefinition("roll", "block", 1, 0, 0.2, 0.5, 48, 0,
            plainZone: false, singleTarget: false, breaksStructures: false, around: true, dashDistance: 0, evades: true));
        // 기운도 장판도 없으면 제자리에서 회피만 하는 기술도 만들 수 있다.
        SkillDefinition still = new SkillDefinition("still", "none", 1, 0, 0, 0.3, 0, 0,
            plainZone: false, singleTarget: false, breaksStructures: false, around: false, dashDistance: 0, evades: true);
        Check(still.Evades && still.DashDistance == 0, "제자리에서 회피하는 기술의 정의가 다릅니다");
    }

    private static void DashStateAndWire()
    {
        // 대시의 방향은 틱을 넘어 남는 상태라 상태 요약에 든다.
        Pad pad = DashPad();
        Player player = pad.F.Player;
        pad.Tap(DashSlotNumber);
        PlayerAction action = player.Actions[0];
        string before = pad.F.Match.StateHash();
        FixedVector kept = action.Direction;
        action.Direction = new FixedVector(Fixed.Zero, Fixed.One);
        Check(pad.F.Match.StateHash() != before, "대시 방향만 다른 두 상태의 요약이 같습니다");
        action.Direction = kept;
        Equal(pad.F.Match.StateHash(), before);

        // 스냅샷에는 대시 단계와 방향(Raw)이 담긴다. 기운이 없으므로 기운을 잇는 중(held)이 아니다.
        using (JsonDocument json = JsonDocument.Parse(Snapshot.Create(pad.F.Match, player, RoomHost.Json)))
        {
            JsonElement root = json.RootElement;
            JsonElement sent = root.GetProperty("players")[0].GetProperty("actions")[0];
            Equal(sent.GetProperty("skill").GetString(), "dash");
            Equal(sent.GetProperty("kind").GetString(), "none");
            Equal(sent.GetProperty("phase").GetString(), "dash");
            Equal(sent.GetProperty("dashX").GetInt64(), kept.X.Raw);
            Equal(sent.GetProperty("dashY").GetInt64(), kept.Y.Raw);
            Check(!sent.GetProperty("held").GetBoolean(), "대시가 기운을 잇는 중으로 나갔습니다");
            // 기운도 장판도 없으므로 장판이 나가는 시각·걷히는 시각·늦어도 나가는 시각이 모두 시작한 시각이다. 끝은 다섯 틱 뒤다.
            double started = sent.GetProperty("startedAt").GetDouble();
            Equal(sent.GetProperty("contactAt").GetDouble(), started);
            Equal(sent.GetProperty("activeUntil").GetDouble(), started);
            Equal(sent.GetProperty("holdUntil").GetDouble(), started);
            Equal((long)Math.Round(sent.GetProperty("endsAt").GetDouble() * Rules.TicksPerSecond), action.StartedTick + DashTicks);
            Equal((long)Math.Round(started * Rules.TicksPerSecond), action.StartedTick);
            JsonElement skills = root.GetProperty("rules").GetProperty("skills");
            bool found = false;
            for (int i = 0; i < skills.GetArrayLength(); i++)
            {
                JsonElement skill = skills[i];
                if (skill.GetProperty("id").GetString() != "dash")
                {
                    // 다른 기술은 대시도 회피도 아니다.
                    Near(skill.GetProperty("dashDistance").GetDouble(), 0);
                    Check(!skill.GetProperty("evades").GetBoolean(), "대시가 아닌 기술이 회피로 나갔습니다");
                    continue;
                }
                found = true;
                Near(skill.GetProperty("dashDistance").GetDouble(), 150);
                Check(skill.GetProperty("evades").GetBoolean(), "대시가 회피로 나가지 않았습니다");
                Check(!skill.TryGetProperty("dashStep", out JsonElement _), "판정용 값(dashStep)이 스냅샷에 담겼습니다");
            }
            Check(found, "규칙의 기술 목록에 대시가 없습니다");
        }
        // 대시가 아닌 기술에는 대시 방향이 빠진다.
        Pad other = DashPad();
        other.Tap(1);
        using (JsonDocument json = JsonDocument.Parse(Snapshot.Create(other.F.Match, other.F.Player, RoomHost.Json)))
        {
            JsonElement sent = json.RootElement.GetProperty("players")[0].GetProperty("actions")[0];
            Check(!sent.TryGetProperty("dashX", out JsonElement _) && !sent.TryGetProperty("dashY", out JsonElement _), "대시가 아닌 기술에 대시 방향이 담겼습니다");
        }
    }
}
