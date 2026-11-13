using Argus.Server.Game;
using Argus.Server.Networking;
using static TestTools;

internal static class EquipmentTests
{
    public static void Register(List<TestCase> tests)
    {
        tests.Add(new TestCase("Four-slot loadouts validate categories and reject changes after first deployment", LoadoutSlots));
        tests.Add(new TestCase("Zero mana prevents abilities; whiffs consume mana once with no regeneration", Mana));
        tests.Add(new TestCase("Input spam cannot stack basic abilities or shorten their recovery", Spam));
        tests.Add(new TestCase("The freely chosen fourth slot casts its selected basic ability", FreeSlot));
        tests.Add(new TestCase("Each kind slot takes any skill of its kind and the free slot takes any skill", KindSlots));
        tests.Add(new TestCase("A skill pressed and released before the next tick still starts once, and of several presses the first one starts", PressBetweenTicks));
        tests.Add(new TestCase("A press that arrives while a skill is running waits only while its button stays held, plus one tick after a quick tap", PressWhileBusy));
        tests.Add(new TestCase("Buttons pressed while a skill runs cast in the order pressed, each only while it stays held", PressesWaitInOrder));
        tests.Add(new TestCase("A held button keeps the aura going and the zone goes out on release, with every later stage pushed back", HoldSustainsAura));
        tests.Add(new TestCase("A held aura lasts at most the maximum aura time, then the zone goes out anyway", HoldHasLimit));
        tests.Add(new TestCase("A button held through its whole skill does not cast again; each cast needs a new press", HeldDoesNotRepeat));
        tests.Add(new TestCase("Pressing another button lets go of the held aura, even when the press passes within one tick", PressOverHeld));
        tests.Add(new TestCase("An input without a press only holds and never starts a skill", HeldWithoutPress));
        tests.Add(new TestCase("An input whose held or pressed slots are out of range, repeated or too many is refused whole", SlotsOutOfRange));
        tests.Add(new TestCase("A press cut off by a disconnect before the next tick does not start", PressThenDisconnect));
        tests.Add(new TestCase("Input silence lets go of a held aura like a release", SilenceReleases));
        tests.Add(new TestCase("The state summary tells apart waiting presses, their order, a let-go aura and how long an aura has been held", InputStateHash));
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
        // 누름 하나는 기술을 한 번만 시작한다. 뗀 입력을 계속 보내며 기술이 끝나도 다시 나가지 않는다.
        pad.Run(0, 60);
        Equal(player.Mana, 23);
        Equal(player.Actions.Count, 0);
        Equal(player.Waiting.Count, 0);

        // 입력을 보내는 사이에 눌렀다 뗀 짧은 누름은 누르고 있는 슬롯 없이 누름만 온다.
        pad.Tap(2);
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Mana, 22);
        pad.Run(0, 60);
        Equal(player.Mana, 22);

        // 한 틱 사이에 여러 기술을 눌렀다 떼면 먼저 누른 기술이 나간다. 누름을 한 자리에 적던 때에는 나중에 누른 것만 나갔다.
        // 뒤에 누른 것은 이미 뗐으므로 한 틱만 더 기다리다가 버려진다. 앞의 기술이 끝난 뒤에 대신 나가지 않는다.
        pad.Send(1, 1);
        pad.Send(3, 3);
        pad.Send(0, 0);
        pad.F.Match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 1);
        Equal(player.Mana, 21);
        Equal(player.Waiting.Count, 1);
        Equal(player.Waiting[0].Slot, 3);
        pad.Run(0, 1);
        Equal(player.Waiting.Count, 0);
        pad.Run(0, 60);
        Equal(player.Mana, 21);
        Equal(player.Actions.Count, 0);
    }

    private static void PressWhileBusy()
    {
        // 기술을 쓰는 중에 눌렀다 뗀 것은 버린다. 기술이 끝난 뒤에 대신 나가지 않는다.
        // 그렇게 쌓아 두면 손을 뗀 뒤 한참 지나 기술이 나간다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Press(1);
        Equal(player.Actions.Count, 1);
        Equal(player.Mana, 23);
        pad.Send(2, 2);
        pad.Send(0, 0);
        pad.F.Match.Step();
        pad.Run(0, 60);
        Equal(player.Mana, 23);
        Equal(player.Actions.Count, 0);

        // 방금 들어온 누름은 이미 뗐더라도 그다음 틱까지 남는다. 그래서 기술이 끝나기 두 틱 전에 짧게 누른 것은 나가고,
        // 세 틱 전에 짧게 누른 것은 버린다. 거의 함께 누른 두 버튼 가운데 앞의 기술이 그 자리에서 끝났을 때, 짧게 누른 뒤의 버튼이
        // 다음 틱에 이어서 나가게 하려는 것이다(AuraTests의 TwoPressesOneTick).
        pad.Tap(1);
        Equal(player.Mana, 22);
        pad.RunUntilBusyLeft(0, 3);
        pad.Tap(2);
        pad.Run(0, 4);
        Equal(player.Mana, 22);
        Equal(player.Actions.Count, 0);
        pad.Tap(1);
        Equal(player.Mana, 21);
        pad.RunUntilBusyLeft(0, 2);
        pad.Tap(2);
        Equal(player.Actions[0].Slot, 1);
        pad.Run(0, 1);
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Mana, 20);
        // 짧게 눌러 시작한 기술이라 버튼은 이미 놓았다. 기운이 이어지지 않는다.
        Check(player.Actions[0].Released, "뗀 누름으로 시작한 기술이 버튼을 누르고 있는 것으로 남았습니다");
        pad.Run(0, 60);

        // 기술을 쓰는 중에 누른 버튼을 그 기술이 끝날 때까지 계속 누르고 있으면, 끝나는 틱에 시작한다.
        pad.Tap(1);
        Equal(player.Mana, 19);
        PlayerAction first = player.Actions[0];
        pad.Press(2);
        Equal(player.Actions[0], first);
        pad.RunUntilBusyLeft(2, 1);
        Equal(player.Actions[0], first);
        pad.Run(2, 1);
        Equal(player.Actions.Count, 1);
        Equal(player.Actions[0].Slot, 2);
        Equal(player.Mana, 18);
        // 아직 누르고 있는 버튼이라 기운이 이어진다.
        Check(!player.Actions[0].Released, "누르고 있는 버튼으로 시작한 기술이 놓은 것으로 적혔습니다");

        // 누르고 있다가 기술이 끝나기 전에 떼면 버린다.
        pad.Run(0, 60);
        Equal(player.Actions.Count, 0);
        pad.Tap(1);
        Equal(player.Mana, 17);
        pad.Press(2);
        pad.Run(2, 3);
        pad.Run(0, 60);
        Equal(player.Mana, 17);
        Equal(player.Actions.Count, 0);
    }

    private static void PressesWaitInOrder()
    {
        // 2026-11-13 사용자 결정의 장면이다. 근접 타격이 받아칠 장판이 없어 끝나기를 기다리는 사이, 받아치기 버튼을 누르고
        // 이어서 잡기 버튼을 눌러 둘 다 누르고 있다. 근접 타격이 끝나면 받아치기, 그것이 끝나면 잡기가 나간다.
        // 누름을 한 자리에 적던 때에는 잡기를 누른 순간 받아치기의 누름이 덮여 사라졌다.
        int[] none = new int[0];
        Pad pad = new Pad();
        Player player = pad.F.Player;
        pad.Tap(1);
        PlayerAction strike = player.Actions[0];
        pad.Run(0, 4);
        pad.Send(new int[] { 2 }, new int[] { 2 });
        pad.F.Match.Step();
        pad.Run(2, 2);
        pad.Send(new int[] { 2, 3 }, new int[] { 3 });
        pad.F.Match.Step();
        Equal(player.Waiting.Count, 2);
        Equal(player.Waiting[0].Slot, 2);
        Equal(player.Waiting[1].Slot, 3);
        while (player.Actions.Count > 0 && player.Actions[0] == strike)
        {
            pad.Send(new int[] { 2, 3 }, none);
            pad.F.Match.Step();
        }
        Equal(pad.F.Match.Tick, strike.EndsTick);
        Equal(player.Actions.Count, 1);
        PlayerAction parry = player.Actions[0];
        Equal(parry.Slot, 2);
        Equal(player.Mana, 22);
        Equal(player.Waiting.Count, 1);
        // 뒤에 누른 버튼이 기다리고 있으므로 앞 기술의 기운은 잇지 않는다. 받아치기 버튼을 누르고 있어도 가장 짧은 기운 시간에 장판이 나간다.
        Check(parry.Released, "뒤에 기다리는 버튼이 있는데 앞 기술의 기운을 잇습니다");
        while (player.Actions.Count > 0 && player.Actions[0] == parry)
        {
            pad.Send(new int[] { 2, 3 }, none);
            pad.F.Match.Step();
        }
        Equal(parry.HeldTicks, 0L);
        Equal(pad.F.Match.Tick, parry.EndsTick);
        Equal(player.Actions.Count, 1);
        PlayerAction grab = player.Actions[0];
        Equal(grab.Slot, 3);
        Equal(player.Mana, 21);
        Equal(player.Waiting.Count, 0);
        // 마지막에 누른 버튼은 누르고 있는 동안 기운이 이어진다.
        Check(!grab.Released, "누르고 있는 마지막 버튼의 기술이 놓은 것으로 적혔습니다");
        // 받아치기 버튼도 아직 누르고 있지만, 누름 하나는 기술을 한 번만 시작한다. 잡기가 끝나도 다시 나가지 않는다.
        for (int i = 0; i < 120; i++)
        {
            pad.Send(new int[] { 2, 3 }, none);
            pad.F.Match.Step();
        }
        Equal(player.Mana, 21);
        Equal(player.Actions.Count, 0);

        // 버튼을 떼면 그 버튼의 기다림만 사라진다. 받아치기 버튼을 떼고 잡기 버튼만 누르고 있으면 잡기가 나간다.
        Pad release = new Pad();
        Player other = release.F.Player;
        release.Tap(1);
        PlayerAction running = other.Actions[0];
        release.Send(new int[] { 2 }, new int[] { 2 });
        release.F.Match.Step();
        release.Send(new int[] { 2, 3 }, new int[] { 3 });
        release.F.Match.Step();
        Equal(other.Waiting.Count, 2);
        release.Send(new int[] { 3 }, none);
        release.F.Match.Step();
        // 뗀 누름은 한 틱 더 보고 버린다.
        release.Run(3, 1);
        Equal(other.Waiting.Count, 1);
        Equal(other.Waiting[0].Slot, 3);
        release.RunUntilBusyLeft(3, 1);
        release.Run(3, 1);
        Check(Gone(other, running), "앞의 기술이 끝나지 않았습니다");
        Equal(other.Actions[0].Slot, 3);
        Equal(other.Mana, 22);

        // 뗐다가 다시 누르면 새 누름이라 맨 뒤로 간다. [받아치기, 잡기]가 기다리는데 받아치기를 뗐다 다시 누르면 [잡기, 받아치기]다.
        // 뗌과 다시 누름이 한 틱 사이에 함께 와도 같다. 틱마다 누르고 있는 버튼만 보면 계속 누르고 있던 것으로 보인다.
        Pad again = new Pad();
        Player third = again.F.Player;
        again.Tap(1);
        again.Send(new int[] { 2 }, new int[] { 2 });
        again.F.Match.Step();
        again.Send(new int[] { 2, 3 }, new int[] { 3 });
        again.F.Match.Step();
        again.Send(new int[] { 3 }, none);
        again.Send(new int[] { 2, 3 }, new int[] { 2 });
        again.F.Match.Step();
        Equal(third.Waiting.Count, 2);
        Equal(third.Waiting[0].Slot, 3);
        Equal(third.Waiting[1].Slot, 2);

        // 누른 채 기다리는 버튼을 같은 슬롯의 다른 키로 또 눌러도 기다리는 자리는 그대로다.
        Pad twice = new Pad();
        Player fourth = twice.F.Player;
        twice.Tap(1);
        twice.Send(new int[] { 2 }, new int[] { 2 });
        twice.F.Match.Step();
        twice.Send(new int[] { 2, 3 }, new int[] { 3 });
        twice.F.Match.Step();
        twice.Send(new int[] { 2, 3 }, new int[] { 2 });
        twice.F.Match.Step();
        Equal(fourth.Waiting.Count, 2);
        Equal(fourth.Waiting[0].Slot, 2);
        Equal(fourth.Waiting[1].Slot, 3);

        // 마나가 모자란 누름은 버리고 그다음 누름을 본다. 한 틱에 기술은 하나만 시작한다.
        Pad poor = new Pad();
        Player fifth = poor.F.Player;
        fifth.Mana = 1;
        poor.Send(new int[] { 1, 2 }, new int[] { 1, 2 });
        poor.F.Match.Step();
        Equal(fifth.Actions.Count, 1);
        Equal(fifth.Actions[0].Slot, 1);
        Equal(fifth.Mana, 0);
        PlayerAction only = fifth.Actions[0];
        while (fifth.Actions.Count > 0 && fifth.Actions[0] == only)
        {
            poor.Send(new int[] { 1, 2 }, none);
            poor.F.Match.Step();
        }
        Equal(fifth.Actions.Count, 0);
        Equal(fifth.Waiting.Count, 0);
    }

    private static void HoldSustainsAura()
    {
        // 타격의 기운은 가장 짧게 0.18초(6틱) 돈다. 짧게 누르면 시작 6틱 뒤에 장판이 나간다.
        Pad tap = new Pad();
        tap.Tap(1);
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
        Check(action.Holding, "누르고 있는 기술이 기운을 잇는 중이 아닙니다");
        Equal(action.HoldUntilTick, started + 30);
        // 시작 뒤 14틱 동안 누르고 있다. 15틱째 입력에서 뗀다.
        pad.Run(1, 14);
        Check(action.HasAura(pad.F.Match.Tick), "누르고 있는데 기운이 끝났습니다");
        Check(!action.ZoneOut(pad.F.Match.Tick), "누르고 있는데 장판이 나갔습니다");
        // 누르고 있는 동안 장판이 나갈 틱은 늘 다음 틱이다. 미리 짐작한 틱이 아니라 지금 정해 둔 틱 그대로다.
        Equal(action.ZoneTick, pad.F.Match.Tick + 1);
        pad.Run(0, 1);
        Equal(action.ZoneTick, started + 15);
        Check(action.ZoneOut(pad.F.Match.Tick), "뗐는데 장판이 나가지 않았습니다");
        Check(!action.HasAura(pad.F.Match.Tick), "장판이 나갔는데 기운이 남아 있습니다");
        Check(!action.Holding, "뗀 기술이 기운을 잇는 중으로 남았습니다");
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
        pad.Run(1, 28);
        Check(action.Holding, "최대 기운 시간 전인데 기운을 잇는 중이 아닙니다");
        pad.Run(1, 1);
        Check(action.HasAura(pad.F.Match.Tick), "최대 기운 시간 전에 기운이 끝났습니다");
        // 다음 틱이 최대 기운 시간이다. 누르고 있어도 더 미뤄지지 않으므로 기운을 잇는 중이 아니다.
        Check(!action.Holding, "최대 기운 시간에 닿았는데 기운을 잇는 중으로 남았습니다");
        pad.Run(1, 1);
        Check(action.ZoneOut(pad.F.Match.Tick), "최대 기운 시간이 지났는데 장판이 나가지 않았습니다");
        Equal(action.ZoneTick, started + 30);
        Equal(action.ZoneTick, action.HoldUntilTick);
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
        Pad brief = new Pad(new Fixture(new Rules { MaxEnemies = 0, MaxAuraSeconds = 0.1 }));
        brief.F.Player.Mana = 24;
        brief.Press(1);
        PlayerAction shortest = brief.F.Player.Actions[0];
        Check(!shortest.Holding, "더 이어질 수 없는 기술이 기운을 잇는 중입니다");
        brief.Run(1, 14);
        Equal(shortest.HeldTicks, 0L);
        Equal(shortest.ZoneTick, shortest.StartedTick + 6);
        Equal(shortest.HoldUntilTick, shortest.StartedTick + 6);
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
        // 슬롯 1을 누르고 있어 기운이 이어지는 중에 슬롯 2를 누른다. 슬롯 1은 놓은 것이 되어 그 틱에 장판이 나간다.
        // 기술은 바꿀 수 없으므로 슬롯 2는 슬롯 1의 기술이 끝날 때까지 누르고 있어야 시작한다.
        // 슬롯 1을 뗀 채 슬롯 2를 눌렀을 때와, 슬롯 1을 누른 채 슬롯 2를 눌렀을 때 모두 같다.
        for (int both = 0; both < 2; both++)
        {
            int[] held = new int[] { 2 };
            if (both == 1)
            {
                held = new int[] { 1, 2 };
            }
            Pad pad = new Pad();
            Player player = pad.F.Player;
            pad.Press(1);
            PlayerAction first = player.Actions[0];
            pad.Run(1, 10);
            Check(first.HasAura(pad.F.Match.Tick), "누르고 있는데 기운이 끝났습니다");
            pad.Send(held, new int[] { 2 });
            pad.F.Match.Step();
            Check(first.ZoneOut(pad.F.Match.Tick), "다른 버튼을 눌렀는데 장판이 나가지 않았습니다");
            Equal(player.Actions.Count, 1);
            Equal(player.Mana, 23);
            while (player.Actions.Count > 0 && player.Actions[0] == first)
            {
                pad.Send(held, new int[0]);
                pad.F.Match.Step();
            }
            Equal(pad.F.Match.Tick, first.EndsTick);
            Equal(player.Actions.Count, 1);
            Equal(player.Actions[0].Slot, 2);
            Equal(player.Mana, 22);
        }

        // 입력이 몰려 와 슬롯 2의 누름이 한 틱 안에 지나가도(누르고 있는 슬롯은 다시 1뿐) 슬롯 1은 놓은 것이 된다.
        // 짧게 누른 슬롯 2는 기술을 쓰는 중이라 버린다.
        Pad burst = new Pad();
        Player other = burst.F.Player;
        burst.Press(1);
        PlayerAction kept = other.Actions[0];
        burst.Run(1, 10);
        burst.Send(1, 0);
        burst.Send(1, 2);
        burst.Send(1, 0);
        burst.F.Match.Step();
        Check(kept.ZoneOut(burst.F.Match.Tick), "몰려 온 누름에 장판이 나가지 않았습니다");
        burst.Run(1, 60);
        Equal(other.Mana, 23);
        Equal(other.Actions.Count, 0);
    }

    private static void HeldWithoutPress()
    {
        // 기술은 누름(pressed)으로만 시작한다. held는 누르고 있음만 뜻하므로 누름 없는 입력으로는 시작하지 않는다.
        // held로 누름을 짐작하면 새로 누른 것과 계속 누르고 있는 것을 가릴 수 없다.
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
        Equal(player.Waiting.Count, 0);
    }

    private static void SlotsOutOfRange()
    {
        // 슬롯이 범위를 벗어났거나, 누르고 있는 슬롯이 겹치거나, 목록이 너무 긴 입력은 통째로 거절한다. 이동과 순번도 바뀌지 않는다.
        Pad pad = new Pad();
        Player player = pad.F.Player;
        Match match = pad.F.Match;
        int[] none = new int[0];
        Check(!match.Input(player, 0, 1, 0, 0, none, new int[] { 5 }));
        Check(!match.Input(player, 0, 1, 0, 0, none, new int[] { -1 }));
        Check(!match.Input(player, 0, 1, 0, 0, none, new int[] { 0 }));
        Check(!match.Input(player, 0, 1, 0, 0, new int[] { 5 }, none));
        Check(!match.Input(player, 0, 1, 0, 0, new int[] { 0 }, none));
        Check(!match.Input(player, 0, 1, 0, 0, new int[] { 2, 2 }, none));
        Check(!match.Input(player, 0, 1, 0, 0, new int[] { 1, 2, 3, 4, 1 }, none));
        int[] tooMany = new int[Match.MaxPressesPerInput + 1];
        for (int i = 0; i < tooMany.Length; i++)
        {
            tooMany[i] = 1;
        }
        Check(!match.Input(player, 0, 1, 0, 0, none, tooMany));
        Equal(player.LastSequence, -1L);
        Equal(player.Move.LengthSquared(), Fixed.Zero);
        match.Step();
        Equal(player.Actions.Count, 0);
        Equal(player.Waiting.Count, 0);
        Equal(player.Mana, 24);

        // 네 버튼을 모두 누르고 있거나, 같은 버튼을 한 입력 안에서 거듭 누른 것은 받는다.
        Check(match.Input(player, 0, 0, 0, 0, new int[] { 4, 3, 2, 1 }, none));
        Check(match.Input(player, 1, 0, 0, 0, none, new int[] { 1, 1, 1, 1, 1, 1, 1, 1 }));
        match.Step();
        Equal(player.Actions.Count, 1);
        Equal(player.Mana, 23);
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

        // 기술을 쓰는 중에 눌러 기다리던 누름도 연결이 끊기면 버린다. 누르고 있던 기운도 놓은 것이 된다.
        Pad waiting = new Pad();
        Player other = waiting.F.Player;
        waiting.Press(1);
        PlayerAction held = other.Actions[0];
        waiting.Send(new int[] { 1, 2 }, new int[] { 2 });
        waiting.F.Match.Step();
        Equal(other.Waiting.Count, 1);
        waiting.F.Match.Disconnect(other);
        Equal(other.Waiting.Count, 0);
        Equal(other.HeldSlots, 0);
        Check(held.Released, "연결이 끊겼는데 기운을 누르고 있는 것으로 남았습니다");
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

        // 받아치기는 기운이 가장 짧게 17틱이라, 입력이 0.35초(11틱) 끊겨도 아직 기운이 돈다. 그 뒤 입력이 돌아와 버튼을 누르고 있다고
        // 알려도 이미 놓은 것이다. 끊긴 것은 뗀 것이므로 기운은 가장 짧은 시간에 끝난다.
        Pad back = new Pad();
        back.Press(2);
        PlayerAction guard = back.F.Player.Actions[0];
        Equal(guard.Skill.Id, "parry");
        long started = guard.StartedTick;
        StepUntil(back.F.Match, started + silent + 1);
        Check(guard.HasAura(back.F.Match.Tick), "가장 짧은 기운 시간 전에 기운이 끝났습니다");
        back.Run(2, 20);
        Equal(guard.HeldTicks, 0L);
        Equal(guard.ZoneTick, started + 17);
    }

    private static void InputStateHash()
    {
        // 기다리는 누름, 누르고 있는 버튼, 놓았다는 표시, 누르고 있어 밀린 틱 수도 상태 필드이므로
        // "상태 필드는 모두 StateHash에 넣는다"는 규칙대로 요약에 든다.
        Pad pressed = new Pad();
        Pad released = new Pad();
        pressed.Send(0, 2);
        released.Send(0, 0);
        Equal(pressed.F.Player.LastSequence, released.F.Player.LastSequence);
        Equal(pressed.F.Player.HeldSlots, released.F.Player.HeldSlots);
        Check(pressed.F.Match.StateHash() != released.F.Match.StateHash(), "기다리는 누름만 다른데 상태 요약이 같습니다");

        // 기술을 쓰는 중에 누르고 있는 버튼이 기다리는 누름인지 아닌지만 다른 두 방이다. 한쪽은 눌렀고, 한쪽은 누르고 있다고만 알렸다.
        Pad armed = new Pad();
        Pad plain = new Pad();
        armed.Tap(1);
        plain.Tap(1);
        armed.Play(2, 2);
        plain.Play(2, 0);
        Equal(armed.F.Player.Waiting.Count, 1);
        Equal(plain.F.Player.Waiting.Count, 0);
        Equal(armed.F.Player.LastSequence, plain.F.Player.LastSequence);
        Equal(armed.F.Player.HeldSlots, plain.F.Player.HeldSlots);
        Check(armed.F.Match.StateHash() != plain.F.Match.StateHash(), "기다리는 누름만 다른데 상태 요약이 같습니다");

        // 기다리는 두 누름의 차례만 다르다.
        Pad forward = new Pad();
        Pad backward = new Pad();
        forward.Tap(1);
        backward.Tap(1);
        forward.Send(new int[] { 2, 3 }, new int[] { 2, 3 });
        backward.Send(new int[] { 2, 3 }, new int[] { 3, 2 });
        forward.F.Match.Step();
        backward.F.Match.Step();
        Equal(forward.F.Player.Waiting[0].Slot, 2);
        Equal(backward.F.Player.Waiting[0].Slot, 3);
        Equal(forward.F.Player.LastSequence, backward.F.Player.LastSequence);
        Check(forward.F.Match.StateHash() != backward.F.Match.StateHash(), "기다리는 누름의 차례만 다른데 상태 요약이 같습니다");

        // 기다리는 누름을 아직 누르고 있는지만 다르다. 한쪽은 뗐다가 누름 없이 다시 누르고 있다고만 알렸다.
        // 지금 누르고 있는 버튼은 같지만, 뗀 누름은 다음 틱에 버려진다.
        Pad kept = new Pad();
        Pad dropped = new Pad();
        kept.Tap(1);
        dropped.Tap(1);
        kept.Play(2, 2);
        dropped.Play(2, 2);
        // 받은 입력의 수(순번)도 요약에 들므로 두 방이 같은 수의 입력을 받게 한다. 수가 다르면 순번 때문에 요약이 달라져,
        // 보려는 값이 요약에 없어도 이 검사가 통과한다.
        kept.Send(2, 0);
        kept.Send(2, 0);
        dropped.Send(0, 0);
        dropped.Send(2, 0);
        Equal(kept.F.Player.LastSequence, dropped.F.Player.LastSequence);
        Equal(kept.F.Player.HeldSlots, dropped.F.Player.HeldSlots);
        Check(kept.F.Player.Waiting[0].Held, "누르고 있는 누름이 뗀 것으로 적혔습니다");
        Check(!dropped.F.Player.Waiting[0].Held, "뗀 누름이 누르고 있는 것으로 남았습니다");
        Check(kept.F.Match.StateHash() != dropped.F.Match.StateHash(), "기다리는 누름을 뗐는지만 다른데 상태 요약이 같습니다");

        // 방금 들어온 누름인지만 다르다. 같은 틱에 같은 버튼이 기다리지만, 한쪽은 한 틱 먼저 눌렀다.
        Pad older = new Pad();
        Pad newer = new Pad();
        older.Tap(1);
        newer.Tap(1);
        older.Play(2, 2);
        newer.Play(0, 0);
        newer.Send(2, 2);
        older.Send(2, 0);
        Equal(older.F.Player.Waiting.Count, 1);
        Equal(newer.F.Player.Waiting.Count, 1);
        Equal(older.F.Player.LastSequence, newer.F.Player.LastSequence);
        Equal(older.F.Player.HeldSlots, newer.F.Player.HeldSlots);
        Check(!older.F.Player.Waiting[0].Fresh, "한 틱이 지난 누름이 방금 들어온 것으로 남았습니다");
        Check(newer.F.Player.Waiting[0].Fresh, "방금 들어온 누름이 지난 것으로 적혔습니다");
        Check(older.F.Match.StateHash() != newer.F.Match.StateHash(), "방금 들어온 누름인지만 다른데 상태 요약이 같습니다");

        // 버튼을 놓았다는 표시만 다르다. 한쪽은 뗐다가 누름 없이 다시 누르고 있다고만 알렸다. 가장 짧은 기운 시간 전이라
        // 밀린 틱 수는 둘 다 0이고 지금 누르고 있는 버튼도 같다.
        Pad holding = new Pad();
        Pad letGo = new Pad();
        holding.Press(1);
        letGo.Press(1);
        holding.Send(1, 0);
        holding.Send(1, 0);
        letGo.Send(0, 0);
        letGo.Send(1, 0);
        Equal(holding.F.Player.LastSequence, letGo.F.Player.LastSequence);
        Equal(holding.F.Player.HeldSlots, letGo.F.Player.HeldSlots);
        Equal(holding.F.Player.Actions[0].HeldTicks, letGo.F.Player.Actions[0].HeldTicks);
        Check(!holding.F.Player.Actions[0].Released, "누르고 있는 기술이 놓은 것으로 적혔습니다");
        Check(letGo.F.Player.Actions[0].Released, "뗀 기술이 누르고 있는 것으로 남았습니다");
        Check(holding.F.Match.StateHash() != letGo.F.Match.StateHash(), "놓았다는 표시만 다른데 상태 요약이 같습니다");

        // 같은 틱에 시작한 같은 기술인데 누르고 있어 밀린 틱 수만 다르다.
        Pad held = new Pad();
        Pad tapped = new Pad();
        held.Press(1);
        tapped.Press(1);
        held.Run(1, 8);
        tapped.Run(0, 8);
        Check(held.F.Player.Actions[0].HeldTicks > 0, "누르고 있는데 기운이 이어지지 않았습니다");
        Equal(tapped.F.Player.Actions[0].HeldTicks, 0L);
        // 누르고 있는 버튼, 놓았다는 표시, 받은 입력 수까지 같게 맞춘 뒤에도 달라야 한다.
        held.Send(0, 0);
        tapped.Send(0, 0);
        Equal(held.F.Player.LastSequence, tapped.F.Player.LastSequence);
        Equal(held.F.Player.HeldSlots, tapped.F.Player.HeldSlots);
        Equal(held.F.Player.Actions[0].Released, tapped.F.Player.Actions[0].Released);
        Check(held.F.Match.StateHash() != tapped.F.Match.StateHash(), "누르고 있던 틱 수만 다른데 상태 요약이 같습니다");

        // 누르고 있는 버튼만 다르다. 기술도 기다리는 누름도 없는 두 방이다.
        Pad one = new Pad();
        Pad two = new Pad();
        one.Send(1, 0);
        two.Send(2, 0);
        Equal(one.F.Player.LastSequence, two.F.Player.LastSequence);
        Check(one.F.Match.StateHash() != two.F.Match.StateHash(), "누르고 있는 버튼만 다른데 상태 요약이 같습니다");
    }

    private static void LoadoutSlots()
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
        f.Match.Input(f.Player, 0, 0, 0, 0, Slots(1), Slots(1));
        Advance(f.Match, 0.2);
        Equal(f.Player.Actions.Count, 0);
        f.Player.Mana = 3;
        f.Match.Input(f.Player, 1, 0, 0, 0, Slots(1), Slots(0));
        Advance(f.Match, 0.2);
        Equal(f.Player.Actions.Count, 0);
        Equal(f.Player.Mana, 3);
        f.Match.Input(f.Player, 2, 0, 0, 0, Slots(0), Slots(1));
        f.Match.Step();
        Equal(f.Player.Mana, 2);
        f.Match.Input(f.Player, 3, 0, 0, 0);
        Advance(f.Match, 20);
        Equal(f.Player.Mana, 2);
    }

    private static void Spam()
    {
        Fixture f = new Fixture();
        f.Player.Mana = 24;
        for (int i = 0; i < 1000; i++)
        {
            Check(f.Match.Input(f.Player, i, 0, 0, 0, Slots(1), Slots(1)));
        }
        f.Match.Step();
        Equal(f.Player.Mana, 23);
        Equal(f.Player.Actions.Count, 1);
        f.Match.Input(f.Player, 1000, 0, 0, 0, Slots(2), Slots(2));
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
            match.Input(player, slot, 0, 0, 0, Slots(slot), Slots(slot));
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
        match.Input(player, 0, 0, 0, 0, Slots(4), Slots(4));
        match.Step();
        Equal(player.Actions[0].Skill.Id, "grab");
        Equal(player.Actions[0].Slot, 4);
        Equal(player.Mana, 0);
    }
}
