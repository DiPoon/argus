using Argus.Server.Game;
using static TestTools;

// 기운·장판 모델의 장면이다(docs/combat.md "기운과 장판", 2026-11-11 합의).
// 기술에는 몸에 도는 기운과 범위에 깔리는 장판이 있다. 적의 장판은 예고할 때부터 대원의 기운과 판정하고,
// 대원의 장판은 나간 뒤에만 적의 기운과 판정한다.
internal static class AuraTests
{
    public static void Register(List<TestCase> tests)
    {
        tests.Add(new TestCase("Three mixed telegraphs fall one per press with no damage, each skill ending at once", MixedCrowd));
        tests.Add(new TestCase("A button still down after its instant perfect counter does not cast again or block the next button", TapsDoNotRecast));
        tests.Add(new TestCase("A wrong button does nothing when pressed, loses when its zone goes out, and the next press can still answer", WrongButton));
        tests.Add(new TestCase("An aura of the same kind waits inside a telegraph and draws only when the zone lands", SameKindWaits));
        tests.Add(new TestCase("One winning aura waits inside a tier-two telegraph; a second one makes it a perfect counter at once", TierTwoNeedsTwo));
        tests.Add(new TestCase("One winning aura still inside a tier-two zone as it lands is a partial counter", TierTwoAlone));
        tests.Add(new TestCase("A perfect counter by the zone also ends the skill, while a plain hit lets it run on", ZoneCounterEndsSkill));
        tests.Add(new TestCase("Once the zone is out the aura is gone, so a zone it would have beaten lands", AuraGoneWithZone));
        tests.Add(new TestCase("A held aura answers a telegraph the moment it starts or the moment the player walks into it", HeldAuraAnswers));
        tests.Add(new TestCase("A grab aura answers the nearest zone it beats, else the nearest zone landing on the player", GrabAuraTarget));
        tests.Add(new TestCase("An enemy block stops the plain counter zone only while its aura lasts", GuardOnlyWithAura));
        tests.Add(new TestCase("Being hit ends the skill at once, even in its recovery", HitFreesAtOnce));
        tests.Add(new TestCase("A button let go before the shortest aura time stays let go, whatever is pressed or held afterwards", LetGoBeforeTheZone));
        tests.Add(new TestCase("Two buttons pressed between two ticks both cast, in the order pressed, and each answers its telegraph", TwoPressesOneTick));
        tests.Add(new TestCase("A zone that lands the very moment the enemy's zone goes out is a plain hit, so it fells a soldier before the attack lands", SameInstantZones));
    }

    // 검사가 직접 만드는 적 행동의 id다.
    private static int _actionId = 40000;
    private static readonly EnemySkill GruntStrike = EnemyDefinition.Grunt.Skills[0];
    private static readonly EnemySkill GruntShove = EnemyDefinition.Grunt.Skills[1];
    private static readonly EnemySkill GruntGrab = EnemyDefinition.Grunt.Skills[2];

    // 대원에게서 degrees(도) 방향으로 distance 떨어진 곳에 서서 대원 쪽으로 skill을 예고하는 병사다. 장판은 arrivesIn초 뒤에 나간다.
    private static Enemy Telegraph(Fixture f, EnemySkill skill, double degrees, int distance, double arrivesIn)
    {
        Enemy enemy = Target(f);
        double radians = degrees * Math.PI / 180;
        enemy.Position = f.Player.Position + Angle.FromRadians(radians).Direction() * distance;
        BeginAction(f, enemy, skill, arrivesIn, radians + Math.PI);
        return enemy;
    }

    // 둘레 기술 셋을 든 대원이다. 1번 회전 베기(타격), 2번 회전 방어(방어), 3번 회전 잡기(잡기)다.
    private static Fixture AroundFixture()
    {
        Fixture f = new Fixture();
        f.Player.Slots = new string[] { "spin", "spinblock", "spingrab", "strike" };
        f.Player.Mana = 24;
        return f;
    }

    private static void MixedCrowd()
    {
        // 합의한 장면이다. 병사 셋이 대원을 둘러싸고 타격·방어·잡기를 함께 예고한다. 맞는 버튼을 차례로 누르면
        // 누를 때마다 그 순간 한 마리씩 쓰러지고, 기술은 장판 없이 끝나 바로 다음 기술을 쓴다. 피해는 없다.
        // 2026-11-11 전에는 회전 베기가 닿는 순간 세 판정이 함께 나 체력 2를 잃었다.
        for (int reversed = 0; reversed < 2; reversed++)
        {
            Fixture f = AroundFixture();
            Enemy striker = Telegraph(f, GruntStrike, 0, 60, 0.6);
            Enemy shover = Telegraph(f, GruntShove, 120, 60, 0.6);
            Enemy grabber = Telegraph(f, GruntGrab, 240, 60, 0.6);
            if (reversed == 1)
            {
                f.Match.Enemies.Reverse();
            }
            long start = f.Match.Tick;
            Pad pad = new Pad(f);
            // 회전 베기: 타격의 기운이 잡기 장판을 이긴다. 타격·방어 장판과는 아무 일도 없다.
            pad.Play(0, 1);
            Near(grabber.Hp, 0);
            Near(striker.Hp, 1);
            Near(shover.Hp, 1);
            Equal(f.Player.Actions.Count, 0);
            // 회전 방어: 방어의 기운이 타격 장판을 이긴다.
            pad.Play(0, 2);
            Near(striker.Hp, 0);
            Near(shover.Hp, 1);
            Equal(f.Player.Actions.Count, 0);
            // 회전 잡기: 잡기의 기운이 방어 장판을 이긴다.
            pad.Play(0, 3);
            Near(shover.Hp, 0);
            Equal(f.Player.Actions.Count, 0);
            Near(f.Player.Hp, f.Player.MaxHp);
            Equal(f.Player.Mana, 21);
            Equal(f.Player.Kills, 3);
            // 세 틱(0.1초)에 끝났다. 가장 빠른 장판도 아직 나가지 않았다.
            Equal(f.Match.Tick, start + 3);
            Equal(f.Match.Enemies.Count, 0);
        }

        // 같은 종류의 예고가 겹치면 한 번 눌러 모두 받아친다. 같은 순간의 판정은 모두 그 순간이 시작할 때의 상태로 한다.
        Fixture same = AroundFixture();
        Enemy first = Telegraph(same, GruntStrike, 0, 60, 0.6);
        Enemy second = Telegraph(same, GruntStrike, 120, 60, 0.6);
        Enemy third = Telegraph(same, GruntStrike, 240, 60, 0.6);
        Pad one = new Pad(same);
        one.Tap(2);
        Near(first.Hp + second.Hp + third.Hp, 0);
        Equal(same.Player.Mana, 23);
        Equal(same.Player.Kills, 3);
        Near(same.Player.Hp, same.Player.MaxHp);
    }

    private static void TapsDoNotRecast()
    {
        // 사람은 버튼을 한 틱 만에 떼지 못한다. 버튼마다 세 틱(0.1초)씩 누른다. 누른 순간 완벽 대응이 나 기술이 끝나도,
        // 아직 누르고 있는 그 버튼으로 기술이 다시 나가지 않는다. 다시 나가면 마나를 더 쓰고 다음 버튼이 막힌다.
        Fixture f = AroundFixture();
        Enemy striker = Telegraph(f, GruntStrike, 0, 60, 0.8);
        Enemy shover = Telegraph(f, GruntShove, 120, 60, 0.8);
        Enemy grabber = Telegraph(f, GruntGrab, 240, 60, 0.8);
        Pad pad = new Pad(f);
        int[] buttons = new int[] { 1, 2, 3 };
        Enemy[] falls = new Enemy[] { grabber, striker, shover };
        for (int i = 0; i < buttons.Length; i++)
        {
            pad.Play(buttons[i], buttons[i]);
            Near(falls[i].Hp, 0);
            Equal(f.Player.Mana, 24 - (i + 1));
            pad.Play(buttons[i], 0);
            pad.Play(buttons[i], 0);
            Equal(f.Player.Actions.Count, 0);
            Equal(f.Player.Mana, 24 - (i + 1));
        }
        Near(f.Player.Hp, f.Player.MaxHp);
        Equal(f.Player.Kills, 3);
    }

    private static void WrongButton()
    {
        // 방어를 예고하는 병사 앞에서 회전 베기를 누른다. 타격의 기운은 방어 장판을 이기지 못하므로 누른 순간에는 아무 일도 없다.
        Fixture f = AroundFixture();
        Enemy shover = Telegraph(f, GruntShove, 0, 55, 0.9);
        Pad pad = new Pad(f);
        pad.Play(0, 1);
        PlayerAction spin = f.Player.Actions[0];
        Near(shover.Hp, 1);
        Near(f.Player.Hp, f.Player.MaxHp);
        while (f.Match.Tick < spin.ZoneTick - 1)
        {
            pad.Play(0, 0);
        }
        Near(shover.Hp, 1);
        Near(f.Player.Hp, f.Player.MaxHp);
        Check(!Gone(f.Player, spin), "장판이 나가기 전에 끊겼습니다");
        // 타격 장판이 나가 병사의 방어 기운에 닿는다. 적의 완벽 대응이다. 대원만 1을 잃고 회전 베기가 끊긴다.
        pad.Play(0, 0);
        Equal(f.Match.Tick, spin.ZoneTick);
        Near(shover.Hp, 1);
        Near(f.Player.Hp, f.Player.MaxHp - 1);
        Check(Gone(f.Player, spin), "방어의 기운에 진 회전 베기가 끊기지 않았습니다");
        Equal(f.Player.Actions.Count, 0);
        // 끊긴 다음 틱에 바로 회전 잡기를 누른다. 그 장판에 이미 당한 대원이지만, 잡기의 기운이 방어 장판을 이겨 누른 순간 병사가 쓰러진다.
        pad.Play(0, 3);
        Equal(f.Match.Tick, spin.ZoneTick + 1);
        Near(shover.Hp, 0);
        Near(f.Player.Hp, f.Player.MaxHp - 1);
        Equal(f.Player.Mana, 22);

        // 다시 누르지 않고 두면, 그 병사의 밀어치기가 실제로 나갈 때 그 대원에게는 다시 닿지 않는다.
        // 한 장판은 한 대원과 한 번만 피해를 주고받는다.
        Fixture once = AroundFixture();
        Enemy again = Telegraph(once, GruntShove, 0, 55, 0.9);
        Pad next = new Pad(once);
        next.Tap(1);
        StepUntil(once.Match, again.Action!.EndsTick);
        Near(again.Hp, 1);
        Near(once.Player.Hp, once.Player.MaxHp - 1);
    }

    private static void SameKindWaits()
    {
        // 타격을 예고하는 병사의 장판 안에서 회전 베기를 누르고 있는다. 같은 종류라 예고 중에는 아무 일도 없다.
        // 병사는 회전 베기의 장판(61)이 닿지 않는 70에 있어, 판정은 병사의 장판이 나가 닿을 때 난다. 그때 비긴다(서로 1).
        Fixture f = AroundFixture();
        Enemy striker = Telegraph(f, GruntStrike, 0, 70, 0.5);
        EnemyAction attack = striker.Action!;
        Pad pad = new Pad(f);
        pad.Play(1, 1);
        PlayerAction spin = f.Player.Actions[0];
        while (f.Match.Tick < attack.ContactTick - 1)
        {
            pad.Play(1, 0);
            Near(striker.Hp, 1);
            Near(f.Player.Hp, f.Player.MaxHp);
        }
        Check(spin.HasAura(f.Match.Tick), "누르고 있는데 기운이 끝났습니다");
        Check(spin.JudgedEnemies.Count == 0, "아무 일도 없었는데 판정한 것으로 적었습니다");
        pad.Play(1, 0);
        Near(striker.Hp, 0);
        Near(f.Player.Hp, f.Player.MaxHp - 1);
        // 비긴 기술은 끊기지 않는다.
        Check(!Gone(f.Player, spin), "비긴 기술이 끝났습니다");
        Equal(f.Player.Actions.Count, 1);
    }

    private static void TierTwoNeedsTwo()
    {
        // 분쇄자의 타격 Ⅱ 장판 안에서 혼자 받아치기를 누르고 있는다. 이기는 기운이 하나라 완벽 대응이 아니고, 예고 중에는
        // 아무 일도 없다(판정을 미룬다). 2026-11-11 전에는 대응 하나가 닿는 순간 부분 대응이 났다.
        // 동료가 회전 방어를 누르는 순간 이기는 기운이 둘이 되어 완벽 대응이다. 대원 순서를 바꿔도 같다.
        EnemySkill heavy = EnemyDefinition.Breaker.Skills[0];
        Equal(heavy.Tier, 2);
        for (int reversed = 0; reversed < 2; reversed++)
        {
            Fixture f = new Fixture();
            f.Player.Mana = 24;
            Player ally = Ally(f, "ally");
            Enemy breaker = Threat(f, EnemyDefinition.Breaker, heavy, 1);
            if (reversed == 1)
            {
                f.Match.Players.Reverse();
            }
            Pad pad = new Pad(f);
            pad.Play(2, 2);
            PlayerAction parry = f.Player.Actions[0];
            for (int i = 0; i < 20; i++)
            {
                pad.Play(2, 0);
            }
            Check(parry.HasAura(f.Match.Tick), "누르고 있는데 받아치기의 기운이 끝났습니다");
            Near(breaker.Hp, 2);
            Near(f.Player.Hp, f.Player.MaxHp);
            Check(parry.JudgedEnemies.Count == 0, "아무 일도 없었는데 판정한 것으로 적었습니다");
            PlayerAction joined = Prepare(f, ally, "spinblock");
            pad.Play(2, 0);
            Near(breaker.Hp, 0);
            Near(f.Player.Hp, f.Player.MaxHp);
            Near(ally.Hp, ally.MaxHp);
            // 두 기술 모두 거기서 끝난다. 처치는 먼저 시작한 기술의 대원이 가져간다.
            Check(Gone(f.Player, parry) && Gone(ally, joined), "완벽 대응을 낸 기술이 끝나지 않았습니다");
            Equal(f.Player.Actions.Count, 0);
            Equal(ally.Actions.Count, 0);
            Equal(f.Player.Kills, 1);
            Equal(ally.Kills, 0);
        }
    }

    private static void TierTwoAlone()
    {
        // 혼자 받아치기를 누른 채 분쇄자의 타격 Ⅱ 장판이 나가 닿는다. 그때 부분 대응이다. 대원과 분쇄자가 1씩 잃고 기술이 끊긴다.
        EnemySkill heavy = EnemyDefinition.Breaker.Skills[0];
        Fixture f = new Fixture();
        f.Player.Mana = 24;
        Enemy breaker = Threat(f, EnemyDefinition.Breaker, heavy, 0.5);
        EnemyAction attack = breaker.Action!;
        Pad pad = new Pad(f);
        pad.Play(2, 2);
        PlayerAction parry = f.Player.Actions[0];
        while (f.Match.Tick < attack.ContactTick - 1)
        {
            pad.Play(2, 0);
        }
        Near(breaker.Hp, 2);
        Near(f.Player.Hp, f.Player.MaxHp);
        pad.Play(2, 0);
        Near(breaker.Hp, 1);
        Near(f.Player.Hp, f.Player.MaxHp - 1);
        Check(Gone(f.Player, parry), "부분 대응한 받아치기가 끊기지 않았습니다");
        Equal(f.Player.Actions.Count, 0);
        // 끊긴 다음 틱에 바로 다음 기술을 쓸 수 있다. 누르고 있던 버튼은 이미 쓴 누름이라 그대로는 다시 나가지 않고, 다시 누르면 나간다.
        pad.Play(2, 2);
        Equal(f.Match.Tick, attack.ContactTick + 1);
        Equal(f.Player.Actions.Count, 1);
        Equal(f.Player.Mana, 22);
    }

    private static void ZoneCounterEndsSkill()
    {
        // 병사가 방어를 예고한다. 대원은 방패가 향한 앞 120° 안이지만 밀어치기의 좁은 장판 밖(축에서 50° 벗어난 곳)에 있다.
        // 장판이 대원을 덮지 않아 잡기의 기운은 받아치지 못한다. 0.12초 뒤 잡기의 장판이 병사의 방어 기운에 닿아 이긴다.
        // 장판의 완벽 대응도 그 기술을 거기서 끝낸다(만들며 정한 것, docs/combat.md).
        Fixture f = new Fixture();
        f.Player.Mana = 24;
        Enemy shover = Target(f);
        shover.Position = f.Player.Position + FixedVector.FromInt(45, 0);
        double offAxis = 50 * Math.PI / 180;
        BeginAction(f, shover, GruntShove, 0.9, Math.PI - offAxis);
        PlayerAction grab = Prepare(f, f.Player, "grab");
        StepUntil(f.Match, grab.ZoneTick - 1);
        Near(shover.Hp, 1);
        Check(!Gone(f.Player, grab), "장판 밖의 기운이 받아쳤습니다");
        f.Match.Step();
        Near(shover.Hp, 0);
        Near(f.Player.Hp, f.Player.MaxHp);
        Check(Gone(f.Player, grab), "완벽 대응을 낸 잡기가 끝나지 않았습니다");
        Equal(f.Player.Actions.Count, 0);
        // 다음 틱에 바로 다음 기술을 쓴다. 잡기가 원래 끝날 틱(시작 26틱 뒤)을 기다리지 않는다.
        Pad pad = new Pad(f);
        pad.Play(0, 1);
        Equal(f.Player.Actions.Count, 1);
        Check(f.Match.Tick < grab.EndsTick, "원래 끝날 틱까지 기다렸습니다");

        // 서 있는 적을 친 것은 완벽 대응이 아니다. 기술은 장판이 걷히고 회복이 끝날 때까지 간다.
        Fixture plain = new Fixture();
        Enemy idle = Target(plain);
        PlayerAction strike = Prepare(plain, plain.Player, "strike");
        StepUntil(plain.Match, strike.ZoneTick);
        Near(idle.Hp, 0);
        Check(!Gone(plain.Player, strike), "서 있는 적을 친 기술이 완벽 대응으로 끝났습니다");
        Equal(plain.Player.Actions.Count, 1);
        StepUntil(plain.Match, strike.EndsTick - 1);
        Equal(plain.Player.Actions.Count, 1);
        plain.Match.Step();
        Equal(plain.Player.Actions.Count, 0);
    }

    private static void AuraGoneWithZone()
    {
        // 장판이 나가면 몸의 기운은 사라진다. 근접 타격의 장판이 나가 있는 동안, 앞 70의 병사가 낸 잡기 장판이 나가 닿는다.
        // 근접 타격의 장판은 병사에게 닿지 않는다(67). 타격의 기운이 남아 있었다면 이겼을 장판이지만, 기운이 없어 대원이 맞는다.
        Fixture f = new Fixture();
        Enemy grabber = Telegraph(f, GruntGrab, 0, 70, Rules.Step);
        PlayerAction strike = Prepare(f, f.Player, "strike", f.Match.Rules.Strike.AuraSeconds);
        Check(strike.ZoneOut(f.Match.Tick + 1) && !strike.HasAura(f.Match.Tick + 1), "장판이 나가 있는 틱이 아닙니다");
        f.Match.Step();
        Near(grabber.Hp, 1);
        Near(f.Player.Hp, f.Player.MaxHp - 1);
        Check(Gone(f.Player, strike), "장판 중에 맞은 근접 타격이 끊기지 않았습니다");

        // 한 틱 늦게 시작해 아직 기운이 도는 근접 타격은 같은 장판을 이긴다.
        Fixture aura = new Fixture();
        Enemy beaten = Telegraph(aura, GruntGrab, 0, 70, Rules.Step);
        PlayerAction late = Prepare(aura, aura.Player, "strike", aura.Match.Rules.Strike.AuraSeconds - 2 * Rules.Step);
        Check(late.HasAura(aura.Match.Tick + 1), "기운이 도는 틱이 아닙니다");
        aura.Match.Step();
        Near(beaten.Hp, 0);
        Near(aura.Player.Hp, aura.Player.MaxHp);
    }

    private static void HeldAuraAnswers()
    {
        // 회전 방어를 누르고 있는 동안 병사가 타격 예고를 시작한다. 예고가 시작된 그 틱에 완벽 대응이다.
        Fixture f = AroundFixture();
        Pad pad = new Pad(f);
        pad.Play(2, 2);
        PlayerAction guard = f.Player.Actions[0];
        for (int i = 0; i < 12; i++)
        {
            pad.Play(2, 0);
        }
        Check(guard.HasAura(f.Match.Tick), "누르고 있는데 기운이 끝났습니다");
        Enemy striker = Telegraph(f, GruntStrike, 90, 60, GruntStrike.Windup);
        Equal(striker.Action!.StartedTick, f.Match.Tick);
        pad.Play(2, 0);
        Near(striker.Hp, 0);
        Check(Gone(f.Player, guard), "완벽 대응을 낸 회전 방어가 끝나지 않았습니다");
        Near(f.Player.Hp, f.Player.MaxHp);

        // 기운을 두른 채 예고 장판 안으로 걸어 들어가면 들어선 틱에 완벽 대응이다. 장판 밖(120)에서는 아무 일도 없다.
        Fixture walk = AroundFixture();
        Enemy far = Telegraph(walk, GruntStrike, 0, 120, 0.8);
        Pad next = new Pad(walk);
        next.Press(2);
        next.Run(2, 1);
        Near(far.Hp, 1);
        walk.Player.Position = far.Position - FixedVector.FromInt(60, 0);
        next.Run(2, 1);
        Near(far.Hp, 0);
        Near(walk.Player.Hp, walk.Player.MaxHp);
    }

    private static void GrabAuraTarget()
    {
        // 잡기의 기운은 장판 하나만 받아친다. 이기는 장판(방어)을 낸 가장 가까운 적이다.
        // 가장 가까운 이기는 장판이 철위병의 방어 Ⅱ면, 혼자서는 아무 일도 없어도 그 장판을 고른다. 뒤의 병사는 받아치지 않는다.
        EnemySkill shield = EnemyDefinition.Warden.Skills[1];
        Equal(shield.Tier, 2);
        Fixture f = new Fixture();
        Enemy warden = Threat(f, EnemyDefinition.Warden, shield, 1);
        // 병사는 철위병 옆 뒤쪽(대원에게서 약 71)에서 대원 쪽으로 밀어치기를 예고한다. 그 장판(75)도 대원을 덮는다.
        Enemy grunt = Target(f);
        grunt.Position = f.Player.Position + FixedVector.FromInt(55, 45);
        _actionId++;
        grunt.Action = new EnemyAction(_actionId, GruntShove, Angle.Of(f.Player.Position - grunt.Position), f.Match.Tick - 5);
        PlayerAction grab = Prepare(f, f.Player, "grab");
        f.Match.Step();
        Equal(grab.Target, warden.Id);
        Near(warden.Hp, 2);
        Near(grunt.Hp, 1);
        Check(!Gone(f.Player, grab), "혼자서 2티어 장판을 완벽 대응했습니다");

        // 이기는 장판이 없으면 지금 실제로 닿는 장판을 낸 가장 가까운 적과 판정한다. 잡기 장판이 나가 닿으면 같은 종류라 비긴다.
        Fixture even = new Fixture();
        Enemy grabber = Telegraph(even, GruntGrab, 0, 70, Rules.Step);
        PlayerAction held = Prepare(even, even.Player, "grab");
        even.Match.Step();
        Equal(held.Target, grabber.Id);
        Near(grabber.Hp, 0);
        Near(even.Player.Hp, even.Player.MaxHp - 1);
        Check(!Gone(even.Player, held), "비긴 잡기가 끊겼습니다");

        // 예고 중인 지는 장판은 대상이 아니다. 타격을 예고하는 가까운 병사가 있어도, 잡기의 기운은 뒤의 방어 장판을 받아친다.
        Fixture mixed = new Fixture();
        Enemy striker = Telegraph(mixed, GruntStrike, 20, 55, 0.8);
        Enemy shover = Telegraph(mixed, GruntShove, -20, 70, 0.8);
        PlayerAction pick = Prepare(mixed, mixed.Player, "grab");
        mixed.Match.Step();
        Equal(pick.Target, shover.Id);
        Near(shover.Hp, 0);
        Near(striker.Hp, 1);
        Near(mixed.Player.Hp, mixed.Player.MaxHp);
    }

    private static void GuardOnlyWithAura()
    {
        // 적의 방어가 받아치기의 반격을 막는 것은 방어의 기운이 도는 동안(예고)이다. 공격 창이 열려 밀어치기가 나가면 기운이 없어,
        // 정면에서 온 반격도 일반 피해를 준다. 그 피해로 병사가 쓰러지면 그 틱에 나간 밀어치기는 무효다.
        Fixture open = new Fixture();
        Enemy shoving = Telegraph(open, GruntShove, 0, 50, Rules.Step);
        PlayerAction counter = Prepare(open, open.Player, "parry", open.Match.Rules.Parry.AuraSeconds);
        Check(counter.ZoneOut(open.Match.Tick + 1), "반격 장판이 나가 있는 틱이 아닙니다");
        open.Match.Step();
        Check(shoving.Action!.ZoneOut(open.Match.Tick), "공격 창이 아닙니다");
        Near(shoving.Hp, 0);
        Near(open.Player.Hp, open.Player.MaxHp);

        // 같은 자리에서 아직 예고 중이면 방어의 기운이 반격을 막는다.
        Fixture telegraph = new Fixture();
        Enemy guarding = Telegraph(telegraph, GruntShove, 0, 50, 0.5);
        Prepare(telegraph, telegraph.Player, "parry", telegraph.Match.Rules.Parry.AuraSeconds);
        telegraph.Match.Step();
        Near(guarding.Hp, 1);
        Near(telegraph.Player.Hp, telegraph.Player.MaxHp);
    }

    private static void HitFreesAtOnce()
    {
        // 근접 타격이 빗나가 회복 중일 때 병사의 타격에 맞는다. 그 기술은 거기서 끝나고, 다음 틱에 바로 다음 기술을 쓸 수 있다.
        Fixture f = new Fixture();
        f.Player.Mana = 24;
        Enemy striker = Telegraph(f, GruntStrike, 180, 70, Rules.Step);
        PlayerAction strike = Prepare(f, f.Player, "strike", 0.5);
        Check(!strike.HasAura(f.Match.Tick + 1) && !strike.ZoneOut(f.Match.Tick + 1), "회복 중인 틱이 아닙니다");
        f.Match.Step();
        Near(f.Player.Hp, f.Player.MaxHp - 1);
        Near(striker.Hp, 1);
        Check(Gone(f.Player, strike), "회복 중에 맞은 기술이 끝나지 않았습니다");
        Check(f.Match.Tick < strike.EndsTick, "기술이 원래 끝날 틱이 이미 지났습니다");
        Pad pad = new Pad(f);
        pad.Play(0, 2);
        Equal(f.Player.Actions.Count, 1);
        Equal(f.Player.Actions[0].Skill.Id, "parry");
    }

    private static void LetGoBeforeTheZone()
    {
        // PR #28 리뷰 1번의 장면이다. 버튼을 놓았는지를 장판이 나갈 틱에만 보던 때에는, 가장 짧은 기운 시간(6틱) 안에 지나간
        // 뗌과 다른 버튼의 누름이 어디에도 남지 않았다.
        // 장면 하나: 회전 방어를 누르고 있다. 두 틱 뒤 다른 버튼을 짧게 눌렀다 뗀다. 회전 방어는 계속 누르고 있다.
        // 다른 버튼을 누른 순간 회전 방어는 놓은 것이므로, 가장 짧은 기운 시간에 장판이 나간다. 예전에는 기운이 1초까지 이어졌다.
        // 두 입력이 틱마다 하나씩 올 때와, 한 틱 사이에 함께 올 때 모두 같다.
        for (int together = 0; together < 2; together++)
        {
            Fixture f = AroundFixture();
            Pad pad = new Pad(f);
            pad.Press(2);
            PlayerAction guard = f.Player.Actions[0];
            long started = guard.StartedTick;
            pad.Run(2, 1);
            pad.Send(new int[] { 2, 1 }, new int[] { 1 });
            if (together == 0)
            {
                f.Match.Step();
            }
            pad.Send(new int[] { 2 }, new int[0]);
            f.Match.Step();
            Check(guard.Released, "다른 버튼을 눌렀는데 누르고 있던 기술을 놓은 것으로 적지 않았습니다");
            while (f.Match.Tick < started + 6)
            {
                pad.Run(2, 1);
            }
            Check(guard.ZoneOut(f.Match.Tick), "가장 짧은 기운 시간에 장판이 나가지 않았습니다");
            Equal(guard.ZoneTick, started + 6);
            Equal(guard.HeldTicks, 0L);
            // 짧게 누른 다른 버튼은 기술을 쓰는 중이라 버려졌다. 회전 방어가 끝나도 나가지 않는다.
            pad.Run(2, 40);
            Equal(f.Player.Actions.Count, 0);
            Equal(f.Player.Mana, 23);
        }

        // 장면 둘: 회전 방어를 짧게 눌렀다 떼고, 0.2초 안에 같은 버튼을 다시 눌러 누르고 있는다. 이미 뗀 첫 시전의 기운은
        // 이어지지 않는다. 다시 누른 것은 새 누름이라, 첫 시전이 끝난 틱에 두 번째 시전이 나가고 그 기운이 이어진다.
        // 예전에는 첫 시전의 기운이 1초까지 늘어나 두 번째 시전이 그만큼 늦었다.
        // 0: 뗀 입력이 틱마다 왔다. 1: 뗀 입력과 다시 누른 입력이 한 틱 사이에 함께 왔다.
        // 2: 클라이언트가 입력을 보내는 두 차례 사이에 뗐다 다시 눌러, 뗀 입력은 없고 누름이 실린 입력만 왔다.
        //    누르고 있는 버튼만 보면 계속 누르고 있던 것이지만, 같은 버튼의 새 누름은 그 사이에 뗐다는 뜻이다.
        for (int together = 0; together < 3; together++)
        {
            Fixture f = AroundFixture();
            Pad pad = new Pad(f);
            pad.Press(2);
            PlayerAction first = f.Player.Actions[0];
            long started = first.StartedTick;
            if (together == 0)
            {
                pad.Run(0, 3);
                Check(first.Released, "뗀 기술을 놓은 것으로 적지 않았습니다");
                pad.Press(2);
            }
            else if (together == 1)
            {
                pad.Run(2, 3);
                pad.Send(0, 0);
                pad.Send(2, 2);
                f.Match.Step();
                Check(first.Released, "한 틱 사이에 뗐다 다시 누른 기술을 놓은 것으로 적지 않았습니다");
            }
            else
            {
                pad.Run(2, 3);
                Check(!first.Released, "누르고 있는 기술을 놓은 것으로 적었습니다");
                pad.Press(2);
                Check(first.Released, "같은 버튼을 새로 눌렀는데 앞의 시전을 놓은 것으로 적지 않았습니다");
            }
            Equal(f.Match.Tick, started + 4);
            Equal(f.Player.Waiting.Count, 1);
            while (f.Match.Tick < started + 6)
            {
                pad.Run(2, 1);
            }
            Check(first.ZoneOut(f.Match.Tick), "이미 뗀 첫 시전의 기운이 이어졌습니다");
            Equal(first.HeldTicks, 0L);
            Equal(first.EndsTick, started + 20);
            while (f.Match.Tick < started + 20)
            {
                pad.Run(2, 1);
            }
            Equal(f.Player.Actions.Count, 1);
            PlayerAction second = f.Player.Actions[0];
            Check(second != first, "첫 시전이 끝나지 않았습니다");
            Equal(second.StartedTick, started + 20);
            Equal(f.Player.Mana, 22);
            pad.Run(2, 10);
            Check(second.HasAura(f.Match.Tick), "누르고 있는 두 번째 시전의 기운이 끝났습니다");
            Check(second.HeldTicks > 0, "누르고 있는 두 번째 시전의 기운이 이어지지 않았습니다");
        }
    }

    private static void TwoPressesOneTick()
    {
        // PR #28 리뷰 2번의 장면이다. 병사 둘이 타격과 잡기를 함께 예고한다. 대원이 회전 베기(잡기를 이김)를 누르고
        // 곧바로 회전 방어(타격을 이김)를 누른다. 두 누름이 서버의 두 틱 사이에 함께 도착한다.
        // 누름을 한 자리에 적던 때에는 뒤의 누름이 앞의 것을 덮어 회전 방어만 나갔고, 잡기 병사가 남았다.
        // 이제 누른 차례대로다. 회전 베기가 나가 잡기 병사를 받아치고 그 자리에서 끝나며, 기다리던 회전 방어가 다음 틱에 나가
        // 타격 병사를 받아친다.
        // 0: 입력 둘로 왔고 두 버튼을 계속 누르고 있다. 1: 클라이언트가 한 입력에 두 누름을 실었다.
        // 2: 두 버튼을 짧게 눌러, 뗀 입력까지 같은 틱 사이에 함께 왔다. 방금 들어온 누름은 뗐더라도 다음 틱까지 남는다.
        int[] none = new int[0];
        for (int scene = 0; scene < 3; scene++)
        {
            Fixture f = AroundFixture();
            Enemy striker = Telegraph(f, GruntStrike, 0, 60, 0.6);
            Enemy grabber = Telegraph(f, GruntGrab, 180, 60, 0.6);
            Pad pad = new Pad(f);
            int[] after = new int[] { 1, 2 };
            if (scene == 1)
            {
                pad.Send(new int[] { 1, 2 }, new int[] { 1, 2 });
            }
            else
            {
                pad.Send(new int[] { 1 }, new int[] { 1 });
                pad.Send(new int[] { 1, 2 }, new int[] { 2 });
            }
            if (scene == 2)
            {
                pad.Send(none, none);
                after = none;
            }
            f.Match.Step();
            Near(grabber.Hp, 0);
            Near(striker.Hp, 1);
            Equal(f.Player.Actions.Count, 0);
            Equal(f.Player.Mana, 23);
            Equal(f.Player.Waiting.Count, 1);
            Equal(f.Player.Waiting[0].Slot, 2);
            pad.Send(after, none);
            f.Match.Step();
            Near(striker.Hp, 0);
            Equal(f.Player.Actions.Count, 0);
            Equal(f.Player.Waiting.Count, 0);
            Equal(f.Player.Mana, 22);
            Equal(f.Player.Kills, 2);
            Near(f.Player.Hp, f.Player.MaxHp);
            // 누르고 있던 버튼으로 기술이 다시 나가지 않는다.
            for (int i = 0; i < 30; i++)
            {
                pad.Send(after, none);
                f.Match.Step();
            }
            Equal(f.Player.Mana, 22);
        }

        // 누른 차례를 바꾸면 쓰러지는 차례도 바뀐다.
        Fixture reversed = AroundFixture();
        Enemy second = Telegraph(reversed, GruntStrike, 0, 60, 0.6);
        Enemy first = Telegraph(reversed, GruntGrab, 180, 60, 0.6);
        Pad other = new Pad(reversed);
        other.Send(new int[] { 1, 2 }, new int[] { 2, 1 });
        reversed.Match.Step();
        Near(second.Hp, 0);
        Near(first.Hp, 1);
        other.Send(new int[] { 1, 2 }, none);
        reversed.Match.Step();
        Near(first.Hp, 0);
        Near(reversed.Player.Hp, reversed.Player.MaxHp);

        // 앞의 기술이 그 자리에서 끝나지 않으면, 짧게 누른 뒤의 버튼은 한 틱 더 기다리다가 버려진다. 손을 뗀 뒤 한참 지나
        // 기술이 나가지 않는다. 뒤의 버튼을 계속 누르고 있으면 앞의 기술이 끝날 때 나간다(EquipmentTests의 PressesWaitInOrder).
        Fixture whiff = AroundFixture();
        Enemy late = Telegraph(whiff, GruntStrike, 0, 60, 0.9);
        Pad taps = new Pad(whiff);
        taps.Send(new int[] { 1 }, new int[] { 1 });
        taps.Send(new int[] { 1, 2 }, new int[] { 2 });
        taps.Send(none, none);
        whiff.Match.Step();
        Equal(whiff.Player.Actions.Count, 1);
        Equal(whiff.Player.Actions[0].Slot, 1);
        Equal(whiff.Player.Waiting.Count, 1);
        taps.Run(0, 1);
        Equal(whiff.Player.Waiting.Count, 0);
        Near(late.Hp, 1);
        Equal(whiff.Player.Mana, 23);
    }

    private static void SameInstantZones()
    {
        // PR #28 리뷰 3번의 장면이고, 2026-11-13에 사용자가 지금대로 두기로 정했다(docs/combat.md "같은 순간에 서로의 장판이 닿을 때").
        // 병사가 방어(밀어치기)를 예고한다. 대원이 병사 앞 50에서 틀린 버튼인 근접 타격을 짧게 누른다.
        // 적의 기운은 장판이 나가는 순간 사라지므로, 바로 그 순간에 깔린 타격 장판은 상성 없는 타격이다. 상성 없는 타격은 먼저
        // 처리하고, 그 피해로 병사가 쓰러지면 그 순간 나간 밀어치기는 무효다. 1/30초 앞이나 뒤면 방어가 타격을 이겨 대원만 1을 잃는다.
        // offset은 타격 장판이 깔리는 틱이 밀어치기가 나가는 틱보다 몇 틱 뒤인지다.
        int[] offsets = new int[] { -1, 0, 1 };
        double[] playerHps = new double[] { 5, 6, 5 };
        double[] soldierHps = new double[] { 1, 0, 1 };
        for (int i = 0; i < offsets.Length; i++)
        {
            Fixture f = new Fixture();
            Enemy shover = Telegraph(f, GruntShove, 0, 50, 0.4);
            long contact = shover.Action!.ContactTick;
            long auraTicks = Rules.ToTicks(f.Match.Rules.Strike.AuraSeconds);
            StepUntil(f.Match, contact + offsets[i] - auraTicks);
            PlayerAction strike = Prepare(f, f.Player, "strike");
            Equal(strike.ZoneTick, contact + offsets[i]);
            StepUntil(f.Match, contact + 2);
            Near(f.Player.Hp, playerHps[i]);
            Near(shover.Hp, soldierHps[i]);
        }

        // 타격을 예고하는 병사에게도 그 순간이면 비김(서로 1) 대신 피해 없는 처치다.
        int[] sameOffsets = new int[] { -1, 0, 1 };
        double[] sameHps = new double[] { 5, 6, 5 };
        for (int i = 0; i < sameOffsets.Length; i++)
        {
            Fixture f = new Fixture();
            Enemy striker = Telegraph(f, GruntStrike, 0, 50, 0.4);
            long contact = striker.Action!.ContactTick;
            long auraTicks = Rules.ToTicks(f.Match.Rules.Strike.AuraSeconds);
            StepUntil(f.Match, contact + sameOffsets[i] - auraTicks);
            Prepare(f, f.Player, "strike");
            StepUntil(f.Match, contact + 2);
            Near(f.Player.Hp, sameHps[i]);
            Near(striker.Hp, 0);
        }

        // 체력 2인 엘리트는 상성 없는 타격에 1만 잃고, 그 순간 나간 장판이 그대로 닿는다. 분쇄자의 타격 Ⅱ는 대원에게 2를 준다.
        EnemySkill heavy = EnemyDefinition.Breaker.Skills[0];
        Fixture elite = new Fixture();
        Enemy breaker = Threat(elite, EnemyDefinition.Breaker, heavy, 0.4);
        long lands = breaker.Action!.ContactTick;
        StepUntil(elite.Match, lands - Rules.ToTicks(elite.Match.Rules.Strike.AuraSeconds));
        Prepare(elite, elite.Player, "strike");
        StepUntil(elite.Match, lands + 2);
        Near(breaker.Hp, 1);
        Near(elite.Player.Hp, elite.Player.MaxHp - 2);
    }
}
