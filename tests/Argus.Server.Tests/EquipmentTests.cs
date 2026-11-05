using Argus.Server.Game;
using Argus.Server.Networking;
using static TestTools;

internal static class EquipmentTests
{
    public static void Register(List<TestCase> tests)
    {
        tests.Add(new TestCase("Four-slot loadouts validate categories and reject changes after first deployment", Slots));
        tests.Add(new TestCase("Zero mana prevents abilities; whiffs consume mana once with no regeneration", Mana));
        tests.Add(new TestCase("Input spam cannot stack basic abilities or shorten their recovery", Spam));
        tests.Add(new TestCase("The freely chosen fourth slot casts its selected basic ability", FreeSlot));
        tests.Add(new TestCase("Each kind slot takes any skill of its kind and the free slot takes any skill", KindSlots));
        tests.Add(new TestCase("A skill pressed and released before the next tick still starts once, and the latest press wins", PressBetweenTicks));
        tests.Add(new TestCase("A press and release that arrive while a skill is running are dropped, not saved for later", PressWhileBusy));
    }

    private static void PressBetweenTicks()
    {
        // 2026-11-05 휴대폰 시험의 장면이다. 입력이 끊겼다가 누른 입력과 뗀 입력이 다음 틱 진행 전에 함께 왔다.
        // 마지막 입력은 뗀 것이지만, 그 사이에 누른 입력이 있었으므로 이번 틱에 기술이 시작된다.
        Fixture f = new Fixture();
        f.Player.Mana = 24;
        Check(f.Match.Input(f.Player, 0, 0, 0, 0, 2));
        Check(f.Match.Input(f.Player, 1, 0, 0, 0, 0));
        f.Match.Step();
        Equal(f.Player.Actions.Count, 1);
        Equal(f.Player.Actions[0].Slot, 2);
        Equal(f.Player.Actions[0].Skill.Id, f.Player.Slots[1]);
        Equal(f.Player.Mana, 23);
        // 누른 기억은 그 틱에만 쓴다. 뗀 입력을 계속 보내며 기술이 끝나도 다시 나가지 않는다.
        long sequence = Released(f, 2, 60);
        Equal(f.Player.Mana, 23);
        Equal(f.Player.Actions.Count, 0);

        // 한 틱 사이에 여러 기술을 눌렀다 떼면 마지막에 누른 기술이 나간다. 계속 누를 때 나중에 누른 것이 나가는 것과 같다.
        Check(f.Match.Input(f.Player, sequence, 0, 0, 0, 1));
        Check(f.Match.Input(f.Player, sequence + 1, 0, 0, 0, 3));
        Check(f.Match.Input(f.Player, sequence + 2, 0, 0, 0, 0));
        f.Match.Step();
        Equal(f.Player.Actions.Count, 1);
        Equal(f.Player.Actions[0].Slot, 3);
        Equal(f.Player.Mana, 22);

        // 누른 기억도 진행 상태다. 기억만 다른 두 방은 상태 요약이 달라야 기록 재생에서 갈라진 것을 잡는다.
        Fixture pressed = new Fixture();
        Fixture released = new Fixture();
        Check(pressed.Match.Input(pressed.Player, 0, 0, 0, 0, 2));
        Check(pressed.Match.Input(pressed.Player, 1, 0, 0, 0, 0));
        Check(released.Match.Input(released.Player, 0, 0, 0, 0, 0));
        Check(released.Match.Input(released.Player, 1, 0, 0, 0, 0));
        Equal(pressed.Player.RequestedSlot, released.Player.RequestedSlot);
        Check(pressed.Match.StateHash() != released.Match.StateHash(), "누른 기억만 다른데 상태 요약이 같습니다");
    }

    private static void PressWhileBusy()
    {
        // 기술을 쓰는 중에 눌렀다 뗀 것은 그 틱에 시작하지 못하면 버린다. 기술이 끝난 뒤에 대신 나가지 않는다.
        // 그렇게 쌓아 두면 손을 뗀 뒤에 기술이 나가, 계속 눌러야 반복되는 지금의 조작과 달라진다.
        Fixture f = new Fixture();
        f.Player.Mana = 24;
        Check(f.Match.Input(f.Player, 0, 0, 0, 0, 1));
        f.Match.Step();
        Equal(f.Player.Actions.Count, 1);
        Equal(f.Player.Mana, 23);
        Check(f.Match.Input(f.Player, 1, 0, 0, 0, 2));
        Check(f.Match.Input(f.Player, 2, 0, 0, 0, 0));
        f.Match.Step();
        Released(f, 3, 60);
        Equal(f.Player.Mana, 23);
        Equal(f.Player.Actions.Count, 0);
    }

    // 아무 기술도 누르지 않은 입력을 틱마다 하나씩 보내며 ticks틱 진행하고, 다음에 쓸 순번을 돌려준다.
    // 클라이언트는 손을 뗀 뒤에도 1/30초마다 입력을 보낸다. 입력 없이 진행하면 0.35초 뒤 입력 끊김 처리(InputTimeoutTicks)가
    // 누른 기억까지 비워, 누른 기억이 남는 결함을 가린다.
    private static long Released(Fixture f, long sequence, int ticks)
    {
        for (int i = 0; i < ticks; i++)
        {
            Check(f.Match.Input(f.Player, sequence, 0, 0, 0, 0));
            sequence++;
            f.Match.Step();
        }
        return sequence;
    }

    private static void Slots()
    {
        using RoomHost host = NewHost();
        string[] invalid = new string[] { "grab", "parry", "grab", "strike" };
        Check(host.Create(new EntryRequest("bad", invalid)) == null);
        Check(!Rules.ValidSlots(new string[] { "strike", "parry", "grab", "turret" }));
        Check(!Rules.ValidSlots(new string[] { "strike", "parry", "grab" }));
        string[] valid = new string[] { "strike", "parry", "grab", "parry" };
        Guest guest = host.Create(new EntryRequest("pilot", valid))!;
        (Room room, Player player, Peer peer) = host.Attach(guest.Room, guest.Token)!.Value;
        Equal(player.Slots[3], "parry");
        valid[3] = "grab";
        Equal(player.Slots[3], "parry");
        Check(!room.Match.SetLoadout(player, invalid));
        Equal(player.Slots[0], "strike");
        room.Match.Enemies.Clear();
        // 방마다 맵이 다르므로 그 방의 캠프에 투입한다.
        Check(room.Match.Deploy(player, room.Match.Layout.Camp.X.ToDouble(), room.Match.Layout.Camp.Y.ToDouble()));
        Check(!room.Match.SetLoadout(player, valid));
        Advance(room.Match, 5.1);
        Check(!room.Match.SetLoadout(player, valid));
        host.Detach(room, player, peer);
        Equal(host.Attach(guest.Room, guest.Token)!.Value.Player.Slots[3], "parry");
    }

    private static void Mana()
    {
        Fixture f = new Fixture();
        f.Match.Input(f.Player, 0, 0, 0, 0, 1);
        Advance(f.Match, 0.2);
        Equal(f.Player.Actions.Count, 0);
        f.Player.Mana = 3;
        f.Match.Input(f.Player, 1, 0, 0, 0, 1);
        f.Match.Step();
        Equal(f.Player.Mana, 2);
        f.Match.Input(f.Player, 2, 0, 0, 0, 0);
        Advance(f.Match, 20);
        Equal(f.Player.Mana, 2);
    }

    private static void Spam()
    {
        Fixture f = new Fixture();
        f.Player.Mana = 24;
        for (int i = 0; i < 1000; i++)
        {
            Check(f.Match.Input(f.Player, i, 0, 0, 0, 1));
        }
        f.Match.Step();
        Equal(f.Player.Mana, 23);
        Equal(f.Player.Actions.Count, 1);
        f.Match.Input(f.Player, 1000, 0, 0, 0, 2);
        f.Match.Step();
        Equal(f.Player.Actions.Count, 1);
        Equal(f.Player.Actions[0].Skill.Id, "strike");
        Equal(f.Player.Mana, 23);
    }

    private static void KindSlots()
    {
        // 앞의 세 칸은 차례로 타격·방어·잡기 종류의 기술 가운데 하나다. 자유 칸은 아무 기술이나 된다.
        Check(Rules.ValidSlots(new string[] { "spin", "spinblock", "spingrab", "strike" }));
        Check(Rules.ValidSlots(new string[] { "strike", "spinblock", "grab", "spingrab" }));
        Check(Rules.ValidSlots(new string[] { "spin", "parry", "spingrab", "spin" }));
        // 종류가 다른 기술은 그 칸에 들 수 없다. 모르는 id와 빈 값도 받지 않는다.
        Check(!Rules.ValidSlots(new string[] { "spinblock", "parry", "grab", "strike" }));
        Check(!Rules.ValidSlots(new string[] { "strike", "spin", "grab", "strike" }));
        Check(!Rules.ValidSlots(new string[] { "strike", "parry", "spinblock", "strike" }));
        Check(!Rules.ValidSlots(new string[] { "strike", "parry", "grab", "whirl" }));
        Check(!Rules.ValidSlots(new string[] { "strike", "parry", "grab", null! }));

        // 칸마다 고른 기술이 나간다.
        Match match = new Match("TEST01", new Rules { MaxEnemies = 0 }, 73);
        Player player = match.Join("p", "pilot")!;
        string[] slots = new string[] { "spin", "spinblock", "spingrab", "parry" };
        Check(match.SetLoadout(player, slots));
        match.Deploy(player, match.Layout.Camp.X.ToDouble(), match.Layout.Camp.Y.ToDouble());
        Advance(match, 5.1);
        for (int slot = 1; slot <= 4; slot++)
        {
            player.Actions.Clear();
            player.BusyUntilTick = 0;
            player.Mana = 1;
            match.Input(player, slot, 0, 0, 0, slot);
            match.Step();
            Equal(player.Actions[0].Skill.Id, slots[slot - 1]);
            Equal(player.Actions[0].Slot, slot);
            Equal(player.Mana, 0);
        }
    }

    private static void FreeSlot()
    {
        Match match = new Match("TEST01", new Rules { MaxEnemies = 0 }, 73);
        Player player = match.Join("p", "pilot")!;
        Check(match.SetLoadout(player, new string[] { "strike", "parry", "grab", "grab" }));
        match.Deploy(player, 300, 730);
        Advance(match, 5.1);
        player.Mana = 1;
        match.Input(player, 0, 0, 0, 0, 4);
        match.Step();
        Equal(player.Actions[0].Skill.Id, "grab");
        Equal(player.Actions[0].Slot, 4);
        Equal(player.Mana, 0);
    }
}
