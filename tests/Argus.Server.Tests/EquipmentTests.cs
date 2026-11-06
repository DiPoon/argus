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
        tests.Add(new TestCase("A press that arrives while a skill is running is dropped, not saved for later", PressWhileBusy));
        tests.Add(new TestCase("A held skill released together with its last held input does not start again", ReleaseWithLastHeld));
        tests.Add(new TestCase("A short press over a held skill starts the pressed skill, and the held skill repeats after it", ShortPressOverHeld));
        tests.Add(new TestCase("An input without press only holds, so a held slot gone by the tick does not start", HeldWithoutPress));
        tests.Add(new TestCase("An input with a press outside the slots is refused whole", PressOutOfRange));
        tests.Add(new TestCase("A press cut off by a disconnect before the next tick does not start", PressThenDisconnect));
    }

    // 입력을 순번대로 보내는 도우미다. held는 입력의 slot(지금 쥐고 있는 슬롯), pressed는 press(지난 입력 뒤에 누른 슬롯)다.
    private sealed class Pad
    {
        public Fixture F { get; }
        private long _sequence;

        public Pad()
        {
            F = new Fixture();
            F.Player.Mana = 24;
        }

        public void Send(int held, int pressed)
        {
            Check(F.Match.Input(F.Player, _sequence, 0, 0, 0, held, pressed));
            _sequence++;
        }

        // 클라이언트처럼 틱마다 입력을 하나씩 보내며 ticks틱 진행한다. 입력 없이 시간을 흘리면 0.35초 뒤 입력 끊김 처리가
        // 쥐고 있던 슬롯을 비워, 슬롯이 남는 결함을 가린다.
        public void Run(int held, int ticks)
        {
            for (int i = 0; i < ticks; i++)
            {
                Send(held, 0);
                F.Match.Step();
            }
        }

        // 지금 기술이 끝나는 틱까지 ticksLeft틱이 남을 때까지 held를 틱마다 보내며 진행한다.
        // ticksLeft가 1이면 다음 Step이 기술이 끝나는 틱이라 새 기술을 시작할 수 있고, 2이면 다음 Step까지는 기술을 쓰는 중이다.
        public void RunUntilBusyLeft(int held, long ticksLeft)
        {
            while (F.Player.BusyUntilTick - F.Match.Tick > ticksLeft)
            {
                Send(held, 0);
                F.Match.Step();
            }
        }
    }

    private static void PressBetweenTicks()
    {
        // 2026-11-05 휴대폰 시험의 장면이다. 입력이 끊겼다가 누른 입력과 뗀 입력이 다음 틱 진행 전에 함께 왔다.
        // 마지막 입력은 뗀 것이지만, 그 사이에 누른 입력이 있었으므로 이번 틱에 기술이 시작된다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Send(2, 2);
        pad.Send(0, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Actions[0].Skill.Id, player.Slots[1]);
        Equal(player.Mana, 23);
        // 누른 기억은 그 틱에만 쓴다. 뗀 입력을 계속 보내며 기술이 끝나도 다시 나가지 않는다.
        pad.Run(0, 60);
        Equal(player.Mana, 23);
        Equal(player.Actions.Count, 0);

        // 입력을 보내는 사이에 눌렀다 뗀 짧은 누름은 쥐고 있는 슬롯 없이 누름만 온다.
        pad.Send(0, 2);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Mana, 22);
        pad.Run(0, 60);
        Equal(player.Mana, 22);

        // 한 틱 사이에 여러 기술을 눌렀다 떼면 마지막에 누른 기술이 나간다. 계속 누를 때 나중에 누른 것이 나가는 것과 같다.
        pad.Send(1, 1);
        pad.Send(3, 3);
        pad.Send(0, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 3);
        Equal(player.Mana, 21);

        // 누른 기억도 상태 필드이므로 "상태 필드는 모두 StateHash에 넣는다"는 규칙대로 요약에 든다. 기록의 요약값은 틱을 진행한
        // 뒤에 계산해 그때는 이 값이 늘 비어 있으므로, 기록 재생이 이 값으로 갈라짐을 잡는 것은 아니다.
        Pad pressed = new Pad();
        Pad released = new Pad();
        pressed.Send(0, 2);
        released.Send(0, 0);
        Equal(pressed.F.Player.RequestedSlot, released.F.Player.RequestedSlot);
        Check(pressed.F.Match.StateHash() != released.F.Match.StateHash(), "누른 기억만 다른데 상태 요약이 같습니다");
    }

    private static void PressWhileBusy()
    {
        // 기술을 쓰는 중에 눌렀다 뗀 것은 그 틱에 시작하지 못하면 버린다. 기술이 끝난 뒤에 대신 나가지 않는다.
        // 그렇게 쌓아 두면 손을 뗀 뒤에 기술이 나가, 계속 눌러야 반복되는 지금의 조작과 달라진다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Send(1, 1);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Mana, 23);
        pad.Send(2, 2);
        pad.Send(0, 0);
        pad.F.Match.Step();
        pad.Run(0, 60);
        Equal(player.Mana, 23);
        Equal(player.Actions.Count, 0);

        // 기술이 끝나기 직전에 짧게 눌렀고, 다음 입력들이 네트워크에서 늦어 기술이 끝나는 틱을 지나서 온다.
        // 누름은 쥐고 있는 슬롯이 아니므로 기술이 끝나도 나가지 않는다.
        pad.Send(1, 1);
        pad.F.Match.Step();
        Equal(player.Mana, 22);
        pad.RunUntilBusyLeft(0, 2);
        pad.Send(0, 2);
        pad.F.Match.Step();
        pad.F.Match.Step();
        pad.F.Match.Step();
        pad.F.Match.Step();
        Equal(player.Mana, 22);
        Equal(player.Actions.Count, 0);
    }

    private static void ReleaseWithLastHeld()
    {
        // 기술을 쥐고 반복하다 그 기술이 끝나기 직전에 손을 뗐다. 마지막 '쥐고 있음'과 뗀 입력이 그 틱 전에 함께 오면,
        // 뗀 뒤이므로 기술이 다시 나가지 않는다. 쥐고 있음을 누름으로 치면 마나와 다음 기술을 쓸 시간을 잃는다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Send(1, 1);
        pad.F.Match.Step();
        Equal(player.Mana, 23);
        pad.RunUntilBusyLeft(1, 1);
        pad.Send(1, 0);
        pad.Send(0, 0);
        pad.F.Match.Step();
        Equal(player.Mana, 23);
        Equal(player.Actions.Count, 0);
        pad.Run(0, 60);
        Equal(player.Mana, 23);

        // 쥐고 있으면 기술이 끝나는 틱에 다시 나간다.
        pad.Send(1, 1);
        pad.F.Match.Step();
        Equal(player.Mana, 22);
        pad.RunUntilBusyLeft(1, 1);
        pad.Send(1, 0);
        pad.F.Match.Step();
        Equal(player.Mana, 21);
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 1);
    }

    private static void ShortPressOverHeld()
    {
        // 슬롯 1을 쥔 채 슬롯 2를 짧게 눌렀고, 그 입력이 쥐고 있음과 함께 몰려 왔다. 서버는 슬롯 2를 눌렀음을 안다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Send(1, 1);
        pad.F.Match.Step();
        Equal(player.Mana, 23);
        pad.RunUntilBusyLeft(1, 1);
        pad.Send(1, 0);
        pad.Send(1, 2);
        pad.Send(1, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Mana, 22);

        // 누른 기술이 끝나면, 계속 쥐고 있던 슬롯 1이 다시 나간다.
        pad.RunUntilBusyLeft(1, 1);
        pad.Send(1, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 1);
        Equal(player.Mana, 21);
    }

    private static void HeldWithoutPress()
    {
        // press를 보내지 않는 클라이언트의 입력이다. slot은 쥐고 있음만 뜻하므로 틱에 마지막 값만 본다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Send(2, 0);
        pad.Send(0, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 0);
        Equal(player.Mana, 24);

        // 틱에 쥐고 있으면 그대로 나간다.
        pad.Send(2, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Mana, 23);
    }

    private static void PressOutOfRange()
    {
        // 범위를 벗어난 press가 든 입력은 통째로 거절한다. 이동과 순번도 바뀌지 않는다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        Check(!pad.F.Match.Input(player, 0, 1, 0, 0, 0, 5));
        Check(!pad.F.Match.Input(player, 0, 1, 0, 0, 0, -1));
        Equal(player.LastSequence, -1L);
        Equal(player.Move.LengthSquared(), Fixed.Zero);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 0);
        Equal(player.Mana, 24);
    }

    private static void PressThenDisconnect()
    {
        // 누른 입력이 온 뒤 다음 틱 전에 연결이 끊겼다. 끊긴 대원은 입력이 멈춘 몸이므로 기술도 나가지 않는다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Send(2, 2);
        pad.F.Match.Disconnect(player);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 0);
        Equal(player.Mana, 24);
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
