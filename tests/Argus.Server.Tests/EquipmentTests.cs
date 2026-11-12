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
        tests.Add(new TestCase("A press that arrives while a skill is running is dropped unless the button stays held until the skill ends", PressWhileBusy));
        tests.Add(new TestCase("A held button keeps the aura going and the zone goes out on release, with every later stage pushed back", HoldSustainsAura));
        tests.Add(new TestCase("A held aura lasts at most the maximum aura time, then the zone goes out anyway", HoldHasLimit));
        tests.Add(new TestCase("A button held through its whole skill does not cast again; each cast needs a new press", HeldDoesNotRepeat));
        tests.Add(new TestCase("Pressing another button lets go of the held aura, even when the press passes within one tick", PressOverHeld));
        tests.Add(new TestCase("An input without press only holds and never starts a skill", HeldWithoutPress));
        tests.Add(new TestCase("An input with a press outside the slots is refused whole", PressOutOfRange));
        tests.Add(new TestCase("A press cut off by a disconnect before the next tick does not start", PressThenDisconnect));
        tests.Add(new TestCase("Input silence lets go of a held aura like a release", SilenceReleases));
        tests.Add(new TestCase("The state summary tells apart a waiting press and how long an aura has been held", InputStateHash));
    }

    // 입력을 순번대로 보내는 도우미다. held는 입력의 slot(지금 누르고 있는 슬롯), pressed는 press(지난 입력 뒤에 누른 슬롯)다.
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
        // 누르고 있던 슬롯을 비워, 슬롯이 남는 결함을 가린다.
        public void Run(int held, int ticks)
        {
            for (int i = 0; i < ticks; i++)
            {
                Send(held, 0);
                F.Match.Step();
            }
        }

        // 버튼을 누른 입력(누름과 누르고 있음)을 보내고 한 틱 진행한다.
        public void Press(int slot)
        {
            Send(slot, slot);
            F.Match.Step();
        }

        // 지금 기술이 끝나는 틱까지 ticksLeft틱이 남을 때까지 held를 틱마다 보내며 진행한다.
        // ticksLeft가 1이면 다음 Step이 기술이 끝나는 틱이라 새 기술을 시작할 수 있고, 2이면 다음 Step까지는 기술을 쓰는 중이다.
        public void RunUntilBusyLeft(int held, long ticksLeft)
        {
            while (F.Player.Actions.Count > 0 && F.Player.Actions[0].EndsTick - F.Match.Tick > ticksLeft)
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

        // 입력을 보내는 사이에 눌렀다 뗀 짧은 누름은 누르고 있는 슬롯 없이 누름만 온다.
        pad.Send(0, 2);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Mana, 22);
        pad.Run(0, 60);
        Equal(player.Mana, 22);

        // 한 틱 사이에 여러 기술을 눌렀다 떼면 마지막에 누른 기술이 나간다.
        pad.Send(1, 1);
        pad.Send(3, 3);
        pad.Send(0, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 3);
        Equal(player.Mana, 21);
    }

    private static void PressWhileBusy()
    {
        // 기술을 쓰는 중에 눌렀다 뗀 것은 버린다. 기술이 끝난 뒤에 대신 나가지 않는다.
        // 그렇게 쌓아 두면 손을 뗀 뒤에 기술이 나간다.
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
        // 뗀 입력이 아직 오지 않았어도 누르고 있다는 입력도 없으므로, 기술이 끝나도 나가지 않는다.
        pad.Send(0, 1);
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

        // 기술을 쓰는 중에 누른 버튼을 그 기술이 끝날 때까지 계속 누르고 있으면, 끝나는 틱에 시작한다.
        pad.Send(0, 1);
        pad.F.Match.Step();
        Equal(player.Mana, 21);
        PlayerAction first = player.Actions[0];
        pad.Send(2, 2);
        pad.F.Match.Step();
        Equal(player.Actions[0], first);
        pad.RunUntilBusyLeft(2, 1);
        Equal(player.Actions[0], first);
        pad.Send(2, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Mana, 20);

        // 누르고 있다가 기술이 끝나기 전에 떼면 버린다.
        pad.Run(0, 60);
        Equal(player.Actions.Count, 0);
        pad.Send(0, 1);
        pad.F.Match.Step();
        Equal(player.Mana, 19);
        pad.Send(2, 2);
        pad.F.Match.Step();
        pad.Run(2, 3);
        pad.Run(0, 60);
        Equal(player.Mana, 19);
        Equal(player.Actions.Count, 0);
    }

    private static void HoldSustainsAura()
    {
        // 타격의 기운은 가장 짧게 0.18초(6틱) 돈다. 짧게 누르면 시작 6틱 뒤에 장판이 나간다.
        Pad tap = new Pad();
        tap.Send(0, 1);
        tap.F.Match.Step();
        PlayerAction quick = tap.F.Player.Actions[0];
        long started = quick.StartedTick;
        tap.Run(0, 10);
        Equal(quick.HeldTicks, 0L);
        Equal(quick.ZoneTick, started + 6);
        Equal(quick.ZoneUntilTick, started + 13);
        Equal(quick.EndsTick, started + 20);

        // 누르고 있으면 기운이 이어지고, 떼면 그 틱에 장판이 나간다. 뒤의 단계는 누르고 있던 만큼 함께 밀린다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Press(1);
        PlayerAction action = player.Actions[0];
        started = action.StartedTick;
        Equal(started, pad.F.Match.Tick);
        // 시작 뒤 14틱 동안 누르고 있다. 15틱째 입력에서 뗀다.
        pad.Run(1, 14);
        Check(action.HasAura(pad.F.Match.Tick), "누르고 있는데 기운이 끝났습니다");
        Check(!action.ZoneOut(pad.F.Match.Tick), "누르고 있는데 장판이 나갔습니다");
        pad.Run(0, 1);
        Equal(action.ZoneTick, started + 15);
        Check(action.ZoneOut(pad.F.Match.Tick), "뗐는데 장판이 나가지 않았습니다");
        Check(!action.HasAura(pad.F.Match.Tick), "장판이 나갔는데 기운이 남아 있습니다");
        Equal(action.HeldTicks, 9L);
        Equal(action.ZoneUntilTick, started + 13 + 9);
        Equal(action.EndsTick, started + 20 + 9);
        // 한 번 나간 장판은 다시 눌러도 기운으로 돌아가지 않는다.
        pad.Run(1, 3);
        Equal(action.ZoneTick, started + 15);
        Equal(player.Mana, 23);

        // 가장 짧은 기운 시간이 지나기 전에 떼면 그 시간이 지난 틱에 장판이 나간다.
        Pad early = new Pad();
        early.Press(1);
        PlayerAction released = early.F.Player.Actions[0];
        early.Run(1, 2);
        early.Run(0, 10);
        Equal(released.HeldTicks, 0L);
        Equal(released.ZoneTick, released.StartedTick + 6);

        // 스냅샷은 누르고 있는 기술의 장판 시각을 최대 기운 시간으로 미리 알리고, 떼면 실제 틱으로 알린다.
        Pad wire = new Pad();
        wire.Press(1);
        PlayerAction shown = wire.F.Player.Actions[0];
        wire.Run(1, 3);
        Equal(wire.F.Match.ExpectedZoneTick(wire.F.Player, shown), shown.StartedTick + 30);
        wire.Run(0, 1);
        Equal(wire.F.Match.ExpectedZoneTick(wire.F.Player, shown), shown.StartedTick + 6);
    }

    private static void HoldHasLimit()
    {
        // 최대 기운 시간은 1초(30틱)다. 계속 누르고 있어도 시작 30틱 뒤에는 장판이 나간다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        Equal(Rules.ToTicks(pad.F.Match.Rules.MaxAuraSeconds), 30L);
        pad.Press(1);
        PlayerAction action = player.Actions[0];
        long started = action.StartedTick;
        pad.Run(1, 29);
        Check(action.HasAura(pad.F.Match.Tick), "최대 기운 시간 전에 기운이 끝났습니다");
        pad.Run(1, 1);
        Check(action.ZoneOut(pad.F.Match.Tick), "최대 기운 시간이 지났는데 장판이 나가지 않았습니다");
        Equal(action.ZoneTick, started + 30);
        Equal(action.EndsTick, started + 20 + 24);

        // 받아치기는 기운이 가장 짧게 0.55초(17틱)다. 누르고 있으면 같은 1초까지 이어진다.
        Pad parry = new Pad();
        parry.Press(2);
        PlayerAction guard = parry.F.Player.Actions[0];
        Equal(guard.Skill.Id, "parry");
        parry.Run(2, 40);
        Equal(guard.ZoneTick, guard.StartedTick + 30);
        Equal(guard.HeldTicks, 13L);

        // 최대 기운 시간이 기술의 가장 짧은 기운 시간보다 짧으면 가장 짧은 시간까지만 돈다.
        Fixture brief = new Fixture(new Rules { MaxEnemies = 0, MaxAuraSeconds = 0.1 });
        brief.Player.Mana = 24;
        Check(brief.Match.Input(brief.Player, 0, 0, 0, 0, 1, 1));
        brief.Match.Step();
        PlayerAction shortest = brief.Player.Actions[0];
        for (int i = 1; i < 15; i++)
        {
            Check(brief.Match.Input(brief.Player, i, 0, 0, 0, 1));
            brief.Match.Step();
        }
        Equal(shortest.HeldTicks, 0L);
        Equal(shortest.ZoneTick, shortest.StartedTick + 6);
    }

    private static void HeldDoesNotRepeat()
    {
        // 버튼을 누른 채로 기술이 끝까지 간다. 기운이 최대까지 이어지고 장판이 나간 뒤 기술이 끝나도 다시 시작하지 않는다.
        // 다시 시작하게 두면, 누른 순간 완벽 대응이 나는 기술이 손을 떼기도 전에 한 번 더 나가 다음 기술을 막는다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Press(1);
        Equal(player.Mana, 23);
        pad.Run(1, 120);
        Equal(player.Mana, 23);
        Equal(player.Actions.Count, 0);

        // 뗐다 다시 누르면 다시 시작한다.
        pad.Run(0, 1);
        pad.Press(1);
        Equal(player.Mana, 22);
        Equal(player.Actions.Count, 1);
    }

    private static void PressOverHeld()
    {
        // 슬롯 1을 누르고 있어 기운이 이어지는 중에 슬롯 2를 누른다. 슬롯 1은 뗀 것이 되어 그 틱에 장판이 나간다.
        // 기술은 바꿀 수 없으므로 슬롯 2는 슬롯 1의 기술이 끝날 때까지 누르고 있어야 시작한다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Press(1);
        PlayerAction first = player.Actions[0];
        pad.Run(1, 10);
        Check(first.HasAura(pad.F.Match.Tick), "누르고 있는데 기운이 끝났습니다");
        pad.Press(2);
        Check(first.ZoneOut(pad.F.Match.Tick), "다른 버튼을 눌렀는데 장판이 나가지 않았습니다");
        Equal(player.Actions.Count, 1);
        Equal(player.Mana, 23);
        pad.RunUntilBusyLeft(2, 1);
        pad.Send(2, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Mana, 22);

        // 입력이 몰려 와 슬롯 2의 누름이 한 틱 안에 지나가도(누르고 있는 슬롯은 다시 1) 슬롯 1은 뗀 것이 된다.
        // 짧게 누른 슬롯 2는 기술을 쓰는 중이라 버린다.
        Pad burst = new Pad();
        Player other = burst.F.Player;
        burst.Press(1);
        PlayerAction held = other.Actions[0];
        burst.Run(1, 10);
        burst.Send(1, 0);
        burst.Send(1, 2);
        burst.Send(1, 0);
        burst.F.Match.Step();
        Check(held.ZoneOut(burst.F.Match.Tick), "몰려 온 누름에 장판이 나가지 않았습니다");
        burst.Run(1, 60);
        Equal(other.Mana, 23);
        Equal(other.Actions.Count, 0);
    }

    private static void HeldWithoutPress()
    {
        // 기술은 누름(press)으로만 시작한다. slot은 누르고 있음만 뜻하므로 press 없는 입력으로는 시작하지 않는다.
        // slot으로 누름을 짐작하면 새로 누른 것과 계속 누르고 있는 것을 가릴 수 없다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Run(2, 30);
        Equal(player.Actions.Count, 0);
        Equal(player.Mana, 24);
        pad.Send(2, 0);
        pad.Send(0, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 0);
        Equal(player.Mana, 24);
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

        // 기술을 쓰는 중에 눌러 기다리던 누름도 연결이 끊기면 버린다.
        Pad waiting = new Pad();
        Player other = waiting.F.Player;
        waiting.Send(0, 1);
        waiting.F.Match.Step();
        waiting.Send(2, 2);
        waiting.F.Match.Step();
        Equal(other.ArmedSlot, 2);
        waiting.F.Match.Disconnect(other);
        Equal(other.ArmedSlot, 0);
        Advance(waiting.F.Match, 2);
        Equal(other.Mana, 23);
    }

    private static void SilenceReleases()
    {
        // 버튼을 누른 채 입력이 끊긴다. 0.35초(11틱) 동안 입력이 없으면 뗀 것으로 보아 장판이 나간다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        // 입력은 지금 틱에 받고, 기술은 다음 틱에 시작한다. 그 뒤로는 입력을 보내지 않는다.
        long received = pad.F.Match.Tick;
        pad.Press(1);
        PlayerAction action = player.Actions[0];
        long silent = Match.InputTimeoutTicks;
        StepUntil(pad.F.Match, received + silent - 1);
        Check(action.HasAura(pad.F.Match.Tick), "입력이 끊긴 지 0.35초가 되기 전에 기운이 끝났습니다");
        pad.F.Match.Step();
        Check(action.ZoneOut(pad.F.Match.Tick), "입력이 0.35초 끊겼는데 장판이 나가지 않았습니다");
        Equal(action.ZoneTick, received + silent);
        // 가장 짧은 기운 시간(6틱)보다 길게 이어졌으므로, 끊긴 입력이 아니라 누르고 있음이 기운을 이은 것이다.
        Check(action.HeldTicks > 0, "누르고 있던 동안 기운이 이어지지 않았습니다");
    }

    private static void InputStateHash()
    {
        // 누른 기억, 기다리는 누름, 누르고 있어 밀린 틱 수도 상태 필드이므로 "상태 필드는 모두 StateHash에 넣는다"는 규칙대로 요약에 든다.
        Pad pressed = new Pad();
        Pad released = new Pad();
        pressed.Send(0, 2);
        released.Send(0, 0);
        Equal(pressed.F.Player.RequestedSlot, released.F.Player.RequestedSlot);
        Check(pressed.F.Match.StateHash() != released.F.Match.StateHash(), "누른 기억만 다른데 상태 요약이 같습니다");

        // 기술을 쓰는 중에 누르고 있는 버튼이 기다리는 누름인지 아닌지만 다른 두 방이다. 한쪽은 눌렀고(press), 한쪽은 누르고 있다고만 알렸다.
        Pad armed = new Pad();
        Pad plain = new Pad();
        armed.Send(0, 1);
        plain.Send(0, 1);
        armed.F.Match.Step();
        plain.F.Match.Step();
        armed.Send(2, 2);
        plain.Send(2, 0);
        armed.F.Match.Step();
        plain.F.Match.Step();
        Equal(armed.F.Player.ArmedSlot, 2);
        Equal(plain.F.Player.ArmedSlot, 0);
        Check(armed.F.Match.StateHash() != plain.F.Match.StateHash(), "기다리는 누름만 다른데 상태 요약이 같습니다");

        // 같은 틱에 시작한 같은 기술인데 누르고 있어 밀린 틱 수만 다르다.
        Pad held = new Pad();
        Pad tapped = new Pad();
        held.Press(1);
        tapped.Press(1);
        held.Run(1, 8);
        tapped.Run(0, 8);
        Check(held.F.Player.Actions[0].HeldTicks > 0, "누르고 있는데 기운이 이어지지 않았습니다");
        Equal(tapped.F.Player.Actions[0].HeldTicks, 0L);
        // 누르고 있는 슬롯과 받은 입력 수까지 같게 맞춘 뒤에도 달라야 한다.
        held.Send(1, 0);
        tapped.Send(1, 0);
        Equal(held.F.Player.RequestedSlot, tapped.F.Player.RequestedSlot);
        Check(held.F.Match.StateHash() != tapped.F.Match.StateHash(), "누르고 있던 틱 수만 다른데 상태 요약이 같습니다");
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
        // 마나가 없을 때 누른 것은 버린다. 누르고 있다가 마나가 차도 저절로 나가지 않는다.
        Fixture f = new Fixture();
        f.Match.Input(f.Player, 0, 0, 0, 0, 1, 1);
        Advance(f.Match, 0.2);
        Equal(f.Player.Actions.Count, 0);
        f.Player.Mana = 3;
        f.Match.Input(f.Player, 1, 0, 0, 0, 1);
        Advance(f.Match, 0.2);
        Equal(f.Player.Actions.Count, 0);
        Equal(f.Player.Mana, 3);
        f.Match.Input(f.Player, 2, 0, 0, 0, 0, 1);
        f.Match.Step();
        Equal(f.Player.Mana, 2);
        f.Match.Input(f.Player, 3, 0, 0, 0, 0);
        Advance(f.Match, 20);
        Equal(f.Player.Mana, 2);
    }

    private static void Spam()
    {
        Fixture f = new Fixture();
        f.Player.Mana = 24;
        for (int i = 0; i < 1000; i++)
        {
            Check(f.Match.Input(f.Player, i, 0, 0, 0, 1, 1));
        }
        f.Match.Step();
        Equal(f.Player.Mana, 23);
        Equal(f.Player.Actions.Count, 1);
        f.Match.Input(f.Player, 1000, 0, 0, 0, 2, 2);
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
            player.Mana = 1;
            match.Input(player, slot, 0, 0, 0, slot, slot);
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
        match.Input(player, 0, 0, 0, 0, 4, 4);
        match.Step();
        Equal(player.Actions[0].Skill.Id, "grab");
        Equal(player.Actions[0].Slot, 4);
        Equal(player.Mana, 0);
    }
}
