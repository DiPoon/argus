using Argus.Server.Game;
using Argus.Server.Networking;
using static TestTools;

internal static class CombatTests
{
    public static void Register(List<TestCase> tests)
    {
        tests.Add(new TestCase("All nine ordinary RPS matchups have the agreed win/draw/loss results", OrdinaryMatrix));
        tests.Add(new TestCase("A telegraphing enemy has an aura; a strike zone reaching a strike aura is a draw", Telegraph));
        tests.Add(new TestCase("Idle enemies take one ordinary damage, without an automatic execution", Idle));
        tests.Add(new TestCase("A parry aura that met nothing still sends its plain counter zone, even against a channel aura", EmptyParry));
        tests.Add(new TestCase("A block aura facing the player stops the plain counter zone without an RPS result", BlockOrdinaryFollowup));
        tests.Add(new TestCase("A parry aura that loses is cut off before its counter zone and does not kill the opponent", InterruptedParry));
        tests.Add(new TestCase("A parry whose aura has ended or faces away cannot answer a zone", InvalidGuards));
        tests.Add(new TestCase("A guard half-angle of a full turn guards every side and a negative one guards none", GuardAngleLimits));
        tests.Add(new TestCase("A grab zone stays out and takes one target per activation", SingleGrab));
        tests.Add(new TestCase("Friendly players can overlap and cannot damage each other", Friendly));
        tests.Add(new TestCase("All three tier-two zones are perfectly countered by two winning auras inside them", CooperativeMatrix));
        tests.Add(new TestCase("A perfect counter protects C irrespective of player iteration order", ProtectBystander));
        tests.Add(new TestCase("An aura that has ended cannot be saved up toward a later tier-two zone", ExpiredContribution));
        tests.Add(new TestCase("Prepared independent effects from one owner also count toward the total", IndependentActions));
        tests.Add(new TestCase("Partial counters cost the player one and deal the skill's partial damage, which can finish an elite", PartialVariants));
        tests.Add(new TestCase("Every elite falls to solo partial counters against each of its tier-two actions", PartialsFinishElites));
        tests.Add(new TestCase("Grabs landing apart on one warden shield are separate partial judgments, each costing the warden one", StaggeredPartials));
        tests.Add(new TestCase("Tier-two draws deal two to each drawing player and one per draw to the elite, with one draw effect per judgment", EliteDraw));
        tests.Add(new TestCase("Reduced HP leaves skill tiers unchanged; a weak skill can still be fully broken", WeakPhase));
        tests.Add(new TestCase("Each elite's tier-two action matches its body color; one block breaks a warden's strike", WardenStrike));
        tests.Add(new TestCase("Wall cover prevents melee hits between otherwise clear endpoints", Cover));
        tests.Add(new TestCase("Wall cover is judged for each player apart, whatever the player order", SightPerPlayer));
        tests.Add(new TestCase("The wall ray finds exact corners, edges, starting walls and both directions without rounding", RayWallEdges));
        tests.Add(new TestCase("Melee destroys walls and mission facilities through normal inputs", Structures));
        tests.Add(new TestCase("Every hit on a breakable wall shows a visible hit effect in front of the wall", WallHitEffect));
        tests.Add(new TestCase("Player-enemy and enemy-enemy bodies block movement while skills allow walking", Bodies));
        tests.Add(new TestCase("Catching up after a stall runs whole ticks, preserving short active windows and preventing body tunneling", LongStep));
        tests.Add(new TestCase("Skills behave by their flags, not their ids: plain zone, single target, structure breaking", SkillFlags));
        tests.Add(new TestCase("A skill definition with a time out of range names that time and its value", SkillTimeErrors));
        tests.Add(new TestCase("Skills around the player hit everyone around without aiming and differ only in affinity", AroundSkills));
        tests.Add(new TestCase("An aura answers a zone covering the player from where the skill faces, beyond the skill's own reach", AuraReach));
        tests.Add(new TestCase("A grab aura answers the block zone covering the player before a nearer idle enemy, whatever the enemy order", GrabTargetOrder));
        tests.Add(new TestCase("A grab is not tied to an enemy that a flank fells before the grab is judged", GrabFlankedTarget));
        tests.Add(new TestCase("Zones landing at the same moment are all judged against the aura worn at that moment, whatever the enemy order", SimultaneousHits));
        tests.Add(new TestCase("A flank outside an enemy action's area deals ordinary damage without its affinity", Flank));
        tests.Add(new TestCase("A player the shield shove covers meets its affinity even beside the shield", ShoveReach));
        tests.Add(new TestCase("A kill goes to the player whose draw or partial damage finished the elite", DrawCredit));
        tests.Add(new TestCase("A grab zone takes the nearest enemy as it goes out, including one that came closer during the aura", GrabRetarget));
        tests.Add(new TestCase("A grab zone picks its target on the tick it goes out and takes the first enemy to enter if none was there", GrabContactTarget));
    }

    private static void OrdinaryMatrix()
    {
        string[] skills = new string[] { "strike", "parry", "grab" };
        string[] kinds = new string[] { "strike", "block", "channel" };
        for (int i = 0; i < 3; i++)
        {
            for (int j = 0; j < 3; j++)
            {
                Fixture f = new Fixture();
                Enemy enemy = Threat(f, kinds[j]);
                PlayerAction action = Prepare(f, f.Player, skills[i]);
                Advance(f.Match, 0.08);
                if (Affinity.Beats(kinds[i], kinds[j]))
                {
                    Near(enemy.Hp, 0);
                    Near(f.Player.Hp, 6);
                }
                else if (i == j)
                {
                    Near(enemy.Hp, 0);
                    Near(f.Player.Hp, 5);
                }
                else
                {
                    Near(enemy.Hp, 1);
                    Near(f.Player.Hp, 5);
                    Check(Gone(f.Player, action), "진 기술이 끊기지 않았습니다");
                }
            }
        }
    }

    private static void Telegraph()
    {
        Fixture f = new Fixture();
        Enemy enemy = Threat(f, "strike", arrivesIn: 2);
        Prepare(f, f.Player, "strike");
        Advance(f.Match, 0.2);
        Near(enemy.Hp, 0);
        Near(f.Player.Hp, 5);
    }

    private static void Idle()
    {
        Fixture f = new Fixture();
        Enemy enemy = Target(f, EnemyDefinition.Breaker);
        Prepare(f, f.Player, "strike");
        Advance(f.Match, 0.7);
        Near(enemy.Hp, 1);
        Near(f.Player.Hp, 6);
        Near(enemy.Definition.Skills[0].Tier, 2);
    }

    private static void EmptyParry()
    {
        Fixture f = new Fixture();
        Enemy enemy = Threat(f, "channel", 2, arrivesIn: 2);
        Prepare(f, f.Player, "parry");
        Advance(f.Match, 0.5);
        Near(enemy.Hp, 2);
        Advance(f.Match, 0.3);
        Near(enemy.Hp, 1);
        Near(f.Player.Hp, 6);
        Check(enemy.Action != null);
        // 반격은 상성이 없어, 잡기의 기운을 두른 적에게 닿아도 당하지 않고 일반 피해만 준다.
        Check(enemy.Action!.HasAura(f.Match.Tick));
    }

    private static void InterruptedParry()
    {
        Fixture f = new Fixture();
        Enemy enemy = Threat(f, "channel");
        PlayerAction action = Prepare(f, f.Player, "parry");
        Advance(f.Match, 0.8);
        Near(f.Player.Hp, 5);
        Near(enemy.Hp, 1);
        Check(Gone(f.Player, action), "잡기에 진 받아치기가 끊기지 않았습니다");
    }

    private static void BlockOrdinaryFollowup()
    {
        Fixture front = new Fixture();
        Enemy guarding = Threat(front, "block", 2, arrivesIn: 2);
        PlayerAction parry = Prepare(front, front.Player, "parry");
        Advance(front.Match, 0.6);
        Near(guarding.Hp, 2);
        Near(front.Player.Hp, 6);
        Check(!Gone(front.Player, parry), "막힌 반격의 받아치기가 끊겼습니다");
        // 막힌 반격 한 번이 방어 종료 뒤 같은 동작에서 다시 피해를 주지 않는다.
        guarding.Action = null;
        Advance(front.Match, 0.1);
        Near(guarding.Hp, 2);

        Fixture rear = new Fixture();
        Enemy facingAway = Threat(rear, "block", 2, arrivesIn: 2);
        facingAway.Action = new EnemyAction(999, facingAway.Action!.Skill, Angle.Zero, rear.Match.Tick);
        Prepare(rear, rear.Player, "parry");
        Advance(rear.Match, 0.8);
        Near(facingAway.Hp, 1);
        Near(rear.Player.Hp, 6);
    }

    private static void GuardAngleLimits()
    {
        // 방어 반각은 방향이 아니라 각도의 크기라 한 바퀴로 감지 않는다(Angle.SpanUnits).
        // 감으면 2π가 0이 되어 정면만 막고, 음수는 거의 한 바퀴가 되어 모든 방향을 막는다.
        Fixture behind = new Fixture(new Rules { MaxEnemies = 0, GuardHalfAngle = Math.Tau });
        Enemy striker = Threat(behind, "strike");
        Prepare(behind, behind.Player, "parry");
        // 등을 돌려도 모든 방향을 막는 방어는 받아친다.
        behind.Player.Aim = Angle.FromRadians(Math.PI);
        Advance(behind.Match, 0.1);
        Near(behind.Player.Hp, 6);
        Check(striker.Hp <= 0, "모든 방향을 막는 방어가 뒤에서 온 타격을 받아치지 못했습니다");

        // 정확히 등 뒤에서 와도 막는다. 방향 벡터는 1/4096 단위로 반올림해 길이가 1보다 조금 길 수 있다(조준 4칸이 그런 예다).
        // 그러면 코사인 -1과 내적으로만 비교할 때 바로 뒤쪽을 놓친다. 조준 π는 방향이 (-1, 0)이라 길이가 정확히 1이어서 이 경우를 보지 못한다.
        Fixture exact = new Fixture(new Rules { MaxEnemies = 0, GuardHalfAngle = Math.Tau });
        exact.Player.Aim = Angle.FromUnits(4);
        FixedVector rounded = exact.Player.Aim.Direction();
        Check(rounded.X.Raw * rounded.X.Raw + rounded.Y.Raw * rounded.Y.Raw > Fixed.Scale * Fixed.Scale, "조준 4칸의 방향 벡터가 1보다 길지 않습니다");
        Enemy behindExactly = Threat(exact, "strike");
        behindExactly.Position = exact.Player.Position - exact.Player.AimDirection * 50;
        // 적은 대원을 향해 친다. 대원의 조준과 같은 방향이다.
        behindExactly.Action = new EnemyAction(behindExactly.Action!.Id, behindExactly.Action.Skill, exact.Player.Aim, exact.Match.Tick);
        Prepare(exact, exact.Player, "parry");
        Advance(exact.Match, 0.1);
        Near(exact.Player.Hp, 6);
        Check(behindExactly.Hp <= 0, "모든 방향을 막는 방어가 정확히 등 뒤에서 온 타격을 받아치지 못했습니다");

        Fixture front = new Fixture(new Rules { MaxEnemies = 0, GuardHalfAngle = -1 });
        Enemy facing = Threat(front, "strike");
        Prepare(front, front.Player, "parry");
        // 정면을 봐도 반각이 음수면 막지 못한다.
        Advance(front.Match, 0.1);
        Near(front.Player.Hp, 5);
        Near(facing.Hp, 1);
    }

    private static void InvalidGuards()
    {
        // 기운은 기술이 향한 쪽으로만 돈다. 등을 돌린 받아치기는 뒤에서 온 타격 장판을 받아치지 못한다.
        Fixture rear = new Fixture();
        Enemy enemy = Threat(rear, "strike");
        Prepare(rear, rear.Player, "parry");
        rear.Player.Aim = Angle.FromRadians(Math.PI);
        Advance(rear.Match, 0.1);
        Near(rear.Player.Hp, 5);
        Near(enemy.Hp, 1);

        // 기운이 끝난 뒤에는 막지 못한다. 0.56초 전에 시작한 받아치기는 기운(0.55초)이 끝나 반격 장판이 나가 있다.
        // 반격 사거리 밖에서 적의 장판만 닿게 하여, 끝난 기운이 받아치지 못하는 것을 본다.
        Fixture expired = new Fixture();
        PlayerAction parry = Prepare(expired, expired.Player, "parry", 0.56);
        Check(!parry.HasAura(expired.Match.Tick), "받아치기의 기운이 아직 돌고 있습니다");
        Enemy second = Threat(expired, "strike");
        second.Position = expired.Player.Position + FixedVector.FromInt(80, 0);
        Advance(expired.Match, 0.1);
        Near(expired.Player.Hp, 5);
        Near(second.Hp, 1);
    }

    private static void SingleGrab()
    {
        Fixture f = new Fixture();
        Enemy first = Target(f);
        Enemy second = Target(f);
        first.Position += FixedVector.FromInt(0, 14);
        second.Position -= FixedVector.FromInt(0, 14);
        PlayerAction grab = Prepare(f, f.Player, "grab");
        Advance(f.Match, 0.6);
        Near(first.Hp + second.Hp, 1);
        Check(grab.Target.HasValue);
        Fixture later = new Fixture();
        Enemy approaching = Target(later);
        approaching.Position += FixedVector.FromInt(200, 0);
        Prepare(later, later.Player, "grab");
        Advance(later.Match, 0.3);
        approaching.Position = later.Player.Position + FixedVector.FromInt(40, 0);
        Advance(later.Match, 0.1);
        Near(approaching.Hp, 0);
    }

    private static void Friendly()
    {
        Fixture f = new Fixture();
        Player ally = Ally(f, "ally");
        ally.Position += FixedVector.FromInt(30, 0);
        f.Player.Mana = 12;
        // 틱마다 타격을 짧게 누르며 동료를 지나간다. 기술은 누를 때만 시작한다.
        for (int i = 0; i < 80; i++)
        {
            f.Match.Input(f.Player, i, 1, 0, 0, Slots(0), Slots(1));
            f.Match.Step();
        }
        Check(f.Player.Mana < 12, "타격을 쓰지 않았습니다");
        Check(f.Player.Position.X > ally.Position.X);
        Near(ally.Hp, ally.MaxHp);
        Near(f.Player.Hp, f.Player.MaxHp);
    }

    private static void CooperativeMatrix()
    {
        string[] kinds = new string[] { "strike", "block", "channel" };
        string[] counters = new string[] { "parry", "grab", "strike" };
        for (int i = 0; i < 3; i++)
        {
            Fixture f = new Fixture();
            Player ally = Ally(f, "ally");
            Enemy enemy = Threat(f, kinds[i], 2);
            Prepare(f, f.Player, counters[i]);
            Prepare(f, ally, counters[i]);
            Advance(f.Match, 0.08);
            Near(enemy.Hp, 0);
            Near(f.Player.Hp, 6);
            Near(ally.Hp, 6);
        }
    }

    private static void ProtectBystander()
    {
        for (int reversed = 0; reversed < 2; reversed++)
        {
            Fixture f = new Fixture();
            Player ally = Ally(f, "ally");
            Player bystander = Ally(f, "bystander");
            Enemy enemy = Threat(f, "strike", 2);
            Prepare(f, f.Player, "parry");
            Prepare(f, ally, "parry");
            if (reversed == 1)
            {
                f.Match.Players.Reverse();
            }
            Advance(f.Match, 0.1);
            Near(enemy.Hp, 0);
            Near(bystander.Hp, 6);
            Near(ally.Hp, 6);
            Near(f.Player.Hp, 6);
        }
    }

    private static void ExpiredContribution()
    {
        Fixture f = new Fixture();
        Player expired = Ally(f, "expired");
        Enemy enemy = Threat(f, "strike", 2);
        enemy.Position = f.Player.Position + FixedVector.FromInt(80, 0);
        Prepare(f, f.Player, "parry");
        Prepare(f, expired, "parry", 0.55);
        Advance(f.Match, 0.1);
        Near(enemy.Hp, 2);
        Near(f.Player.Hp, 5);
        Near(expired.Hp, 4);
    }

    private static void IndependentActions()
    {
        Fixture f = new Fixture();
        Enemy enemy = Threat(f, "strike", 2);
        // 현재 기본기는 겹쳐 시전할 수 없다. 합산 자체는 소유자 수가 아니라 유효한 기술 수를 센다.
        Prepare(f, f.Player, "parry");
        Prepare(f, f.Player, "parry");
        Advance(f.Match, 0.1);
        Near(enemy.Hp, 0);
        Near(f.Player.Hp, 6);
    }

    private static void PartialVariants()
    {
        // 2티어 행동에 맞는 대응이 하나뿐이면(부분 대응) 대원은 피해 1을 받고 기술이 중단된다. 적은 기술별 부분 대응 피해를 받는다.
        for (int partial = 0; partial <= 1; partial++)
        {
            Fixture f = new Fixture();
            Enemy enemy = Threat(f, "strike", 2, partial);
            PlayerAction parry = Prepare(f, f.Player, "parry");
            Advance(f.Match, 0.8);
            Near(enemy.Hp, 2 - partial);
            Near(f.Player.Hp, 5);
            Check(Gone(f.Player, parry), "부분 대응한 받아치기가 끊기지 않았습니다");
            // 체력 1인 적에게 다시 부분 대응한다. 부분 대응 피해가 있으면 그 피해로 쓰러지고, 처치는 부분 대응한 대원이 가져간다.
            enemy.Hp = 1;
            enemy.Action = new EnemyAction(999, new EnemySkill("strike", 2, partial, 0.05, 85, 25), Angle.FromRadians(Math.PI), f.Match.Tick);
            Prepare(f, f.Player, "parry");
            Advance(f.Match, 0.1);
            Near(enemy.Hp, 1 - partial);
            Equal(f.Player.Kills, partial);
        }
        Fixture none = new Fixture();
        Enemy uncountered = Threat(none, "strike", 2);
        Advance(none.Match, 0.5);
        Near(none.Player.Hp, 4);
        Near(uncountered.Hp, 2);
    }

    private static void PartialsFinishElites()
    {
        // 엘리트의 2티어 행동마다, 혼자 맞는 대응이 실제로 닿으면(부분 대응) 대원과 엘리트가 함께 피해 1을 받는다.
        // 그래서 체력만큼 부분 대응하면 엘리트가 쓰러진다. 2026-10-28 전에는 부분 대응으로 쓰러지지 않았다.
        // 분쇄자는 피해가 없었고, 철위병은 체력 1에서 멈췄다.
        // 받아치기(타격 Ⅱ)는 닿는 공격을 막을 때, 잡기(방어 Ⅱ)는 예고 중에 먼저 닿을 때 판정받으므로 행동마다 따로 본다.
        int checkedSkills = 0;
        for (int i = 0; i < EnemyDefinition.All.Count; i++)
        {
            EnemyDefinition definition = EnemyDefinition.All[i];
            for (int j = 0; j < definition.Skills.Length; j++)
            {
                EnemySkill skill = definition.Skills[j];
                if (skill.Tier != 2)
                {
                    continue;
                }
                checkedSkills++;
                Fixture f = new Fixture();
                string counter = CounterFor(f.Match.Rules, skill.Kind);
                Enemy elite = Target(f, definition);
                for (int round = 1; round <= definition.Health; round++)
                {
                    f.Player.Hp = f.Player.MaxHp;
                    BeginAction(f, elite, skill, 0.2);
                    Prepare(f, f.Player, counter);
                    Advance(f.Match, 0.3);
                    Near(f.Player.Hp, f.Player.MaxHp - 1);
                    Near(elite.Hp, definition.Health - round);
                }
                Equal(f.Player.Kills, 1);
                Check(!f.Match.Enemies.Contains(elite), $"{definition.Name} 처치 뒤에도 적 목록에 남아 있습니다({skill.Kind})");
            }
        }
        Check(checkedSkills > 0, "2티어 행동이 있는 적 종류가 없습니다");
    }

    private static void StaggeredPartials()
    {
        // 철위병은 방어 Ⅱ를 예고하는 1.2초 동안 방어의 기운을 두른다. 그동안 잡기의 장판이 따로 닿으면 판정도 따로 난다.
        // 맞는 대응이 따로 닿을 때마다 부분 대응이고, 철위병도 판정마다 부분 대응 피해를 받는다(2026-10-31 결정).
        // 대원들은 철위병의 장판 안에 있지만 잡기를 짧게 눌러, 기운(0.12초)이 겹치지 않는다. 겹치면 그 순간 완벽 대응이다(AuraTests).
        EnemySkill shield = EnemyDefinition.Warden.Skills[1];
        Equal(shield.Kind, "block");
        Equal(shield.Tier, 2);

        // 0.1초 차이로 잡는다. 앞 잡기의 장판이 나가 닿을 때(0.12초) 뒤 잡기의 기운이 장판 안에서 돌고 있어 한 판정에 함께 들어간다.
        // 같은 순간의 대응은 장판과 기운을 가리지 않고 합산한다. 맞는 대응이 둘이라 완벽 대응이다.
        // 아무도 다치지 않고 먼저 시작한 대원이 처치를 가져간다.
        Fixture together = new Fixture();
        Player close = Ally(together, "close");
        Enemy first = Threat(together, EnemyDefinition.Warden, shield, shield.Windup);
        Prepare(together, together.Player, "grab");
        Advance(together.Match, 0.1);
        Prepare(together, close, "grab");
        Advance(together.Match, 0.1);
        Near(first.Hp, 0);
        Near(together.Player.Hp, together.Player.MaxHp);
        Near(close.Hp, close.MaxHp);
        Equal(together.Player.Kills, 1);
        Equal(close.Kills, 0);

        // 0.5초 차이로 잡는다. 앞 잡기가 혼자 판정받은 뒤 뒤 잡기가 따로 판정받아, 두 번 모두 부분 대응이다.
        Fixture apart = new Fixture();
        Player late = Ally(apart, "late");
        Enemy second = Threat(apart, EnemyDefinition.Warden, shield, shield.Windup);
        Prepare(apart, apart.Player, "grab");
        Advance(apart.Match, 0.5);
        Near(apart.Player.Hp, apart.Player.MaxHp - 1);
        Near(second.Hp, 1);
        Prepare(apart, late, "grab");
        Advance(apart.Match, 0.2);
        Near(late.Hp, late.MaxHp - 1);
        Near(second.Hp, 0);
        Equal(apart.Player.Kills, 0);
        Equal(late.Kills, 1);

        // 혼자 두 번 잡는다. 첫 잡기가 부분 대응으로 중단된 뒤 같은 예고 안에 다시 잡아, 대원은 두 번 다 피해 1을 받는다.
        Fixture alone = new Fixture();
        Enemy third = Threat(alone, EnemyDefinition.Warden, shield, shield.Windup);
        Prepare(alone, alone.Player, "grab");
        Advance(alone.Match, 0.5);
        Near(alone.Player.Hp, alone.Player.MaxHp - 1);
        Near(third.Hp, 1);
        Prepare(alone, alone.Player, "grab");
        Advance(alone.Match, 0.2);
        Near(alone.Player.Hp, alone.Player.MaxHp - 2);
        Near(third.Hp, 0);
        Equal(alone.Player.Kills, 1);
    }

    // 남아 있는 효과 가운데 kind 종류의 수다. 판정 하나에 같은 효과가 겹쳐 생기지 않았는지 볼 때 쓴다.
    private static int CountEffects(Match match, string kind)
    {
        int count = 0;
        for (int i = 0; i < match.Effects.Count; i++)
        {
            if (match.Effects[i].Kind == kind)
            {
                count++;
            }
        }
        return count;
    }

    // 적 행동의 종류를 이기는 대원 기술의 id다.
    private static string CounterFor(Rules rules, string attackKind)
    {
        string[] ids = new string[] { "strike", "parry", "grab" };
        for (int i = 0; i < ids.Length; i++)
        {
            if (Affinity.Beats(rules.Skill(ids[i]).Kind, attackKind))
            {
                return ids[i];
            }
        }
        throw new Exception($"이기는 기술이 없는 적 행동 종류입니다: {attackKind}");
    }

    private static void EliteDraw()
    {
        Fixture f = new Fixture();
        Enemy enemy = Threat(f, "strike", 2);
        Prepare(f, f.Player, "strike");
        Advance(f.Match, 0.6);
        Near(f.Player.Hp, 4);
        Near(enemy.Hp, 1);

        // 두 대원이 한 판정에 함께 비기면 엘리트 피해는 비긴 대원 수만큼 쌓이고(임시 처리), 먼저 시작한 대원이 처치를 가져간다.
        // 비김 효과는 판정 하나에 하나다. 효과는 적 자리에 그려지므로 대원마다 만들면 같은 모양이 겹쳐 그려진다.
        Fixture pair = new Fixture();
        Player partner = Ally(pair, "partner");
        Enemy shared = Threat(pair, "strike", 2);
        Prepare(pair, pair.Player, "strike");
        Prepare(pair, partner, "strike");
        Advance(pair.Match, 0.1);
        Near(pair.Player.Hp, 4);
        Near(partner.Hp, 4);
        Near(shared.Hp, 0);
        Equal(pair.Player.Kills, 1);
        Equal(partner.Kills, 0);
        Equal(CountEffects(pair.Match, "draw"), 1);
    }

    private static void WeakPhase()
    {
        Fixture f = new Fixture();
        Enemy elite = Target(f, EnemyDefinition.Warden);
        elite.Action = new EnemyAction(999, elite.Definition.Skills[2], Angle.FromRadians(Math.PI), f.Match.Tick);
        Prepare(f, f.Player, "strike");
        Advance(f.Match, 0.2);
        Near(elite.Hp, 0);
        Near(f.Player.Hp, 6);
        // 철위병은 방어만 2티어다(2026-11-05부터 타격은 1티어).
        Equal(elite.Definition.Skills[0].Tier, 1);
        Equal(elite.Definition.Skills[1].Tier, 2);
    }

    private static void WardenStrike()
    {
        // 엘리트가 어떤 2티어 행동을 쓰는지 몸 색으로 알아보게 한다(합의 규칙: 크기와 특징으로 알아보게 한다).
        // 분쇄자는 몸이 타격 색(빨강)이고 타격만 2티어다. 철위병은 몸이 방어 색(파랑)이고 방어만 2티어다.
        // 색은 클라이언트(world.ts)가 적 종류로 고른다. 철위병의 타격이 2티어였을 때 휴대폰 시험에서 헷갈렸다(2026-11-05).
        Equal(EnemyDefinition.Breaker.Skills[0].Tier, 2);
        Equal(EnemyDefinition.Breaker.Skills[1].Tier, 1);
        Equal(EnemyDefinition.Breaker.Skills[2].Tier, 1);
        Equal(EnemyDefinition.Warden.Skills[0].Tier, 1);
        Equal(EnemyDefinition.Warden.Skills[1].Tier, 2);
        Equal(EnemyDefinition.Warden.Skills[2].Tier, 1);
        // 그래서 철위병의 타격은 혼자 방어 하나로 완벽 대응이다. 대원은 피해가 없고, 철위병은 체력과 관계없이 쓰러진다.
        Fixture f = new Fixture();
        EnemySkill strike = EnemyDefinition.Warden.Skills[0];
        Enemy warden = Threat(f, EnemyDefinition.Warden, strike, 0.2);
        Prepare(f, f.Player, CounterFor(f.Match.Rules, strike.Kind));
        Advance(f.Match, 0.3);
        Near(f.Player.Hp, f.Player.MaxHp);
        Check(!f.Match.Enemies.Contains(warden), "철위병의 타격을 혼자 방어로 막았는데 쓰러지지 않았습니다");
        Equal(f.Player.Kills, 1);
        // 대원이 받는 피해도 행동의 티어다. 대응하지 않고 맞으면 피해 1이다(2티어였을 때는 2).
        Fixture hit = new Fixture();
        Threat(hit, EnemyDefinition.Warden, strike, 0.2);
        Advance(hit.Match, 0.3);
        Near(hit.Player.Hp, hit.Player.MaxHp - 1);
    }

    private static void RayWallEdges()
    {
        // 장애물 타일 (10, 10)은 x 480~528, y 480~528이다. 경계를 지나는 순서를 나누지 않고 엇갈려 곱해 비교하므로
        // 꼭짓점이나 경계 위를 지나는 선분도 반올림 없이 판정한다. 비율은 1/4096 단위로 반올림한 값이다.
        BattleMap map = new BattleMap(MissionLayout.CreateHandmade());
        int tile = 10 * map.Columns + 10;
        bool layout = map.Solid(10, 10) && !map.Solid(9, 10) && !map.Solid(10, 9);
        Check(layout, "검사 조건(타일 배치)이 바뀌었습니다");

        // 꼭짓점 (480, 480)을 정확히 지나는 대각선이다. 양옆 타일이 비어 있으므로 대각선 너머의 벽 타일에 닿는다. 비율은 80 / 200 = 0.4다.
        FixedVector cornerFrom = FixedVector.FromInt(400, 400);
        FixedVector cornerTo = FixedVector.FromInt(600, 600);
        WallHit corner = map.RayWall(cornerFrom, cornerTo);
        Check(corner.Hit, "꼭짓점을 지나는 선분이 벽을 지나쳤습니다");
        Equal(corner.Tile, tile);
        Equal(corner.Fraction.Raw, 1638L);

        // 타일 윗면(y = 480) 위를 따라가는 선분은 그 줄(y 480~528)에 있으므로 벽에 닿는다. Raw 하나 위는 윗줄이라 닿지 않는다.
        FixedVector edgeFrom = FixedVector.FromInt(400, 480);
        FixedVector edgeTo = FixedVector.FromInt(600, 480);
        WallHit along = map.RayWall(edgeFrom, edgeTo);
        Check(along.Hit, "경계 위를 지나는 선분이 벽을 지나쳤습니다");
        Equal(along.Tile, tile);
        Equal(along.Fraction.Raw, 1638L);
        Fixed above = Fixed.FromRaw(480 * Fixed.Scale - 1);
        FixedVector aboveFrom = new FixedVector(Fixed.FromInt(400), above);
        FixedVector aboveTo = new FixedVector(Fixed.FromInt(600), above);
        bool aboveClear = map.LineOfSight(aboveFrom, aboveTo);
        Check(aboveClear, "경계 바로 위의 선분이 막혔습니다");

        // 반대 방향(오른쪽에서 왼쪽)으로는 오른쪽 면 x = 528에서 닿는다. 비율은 72 / 200 = 0.36(1474.56칸)이라 1475다.
        FixedVector backFrom = FixedVector.FromInt(600, 500);
        FixedVector backTo = FixedVector.FromInt(400, 500);
        WallHit back = map.RayWall(backFrom, backTo);
        Check(back.Hit, "반대 방향 선분이 벽을 지나쳤습니다");
        Equal(back.Tile, tile);
        Equal(back.Fraction.Raw, 1475L);

        // 벽 안에서 시작하면 비율 0에서 닿는다.
        FixedVector insideFrom = FixedVector.FromInt(500, 500);
        FixedVector insideTo = FixedVector.FromInt(700, 500);
        WallHit inside = map.RayWall(insideFrom, insideTo);
        Check(inside.Hit, "벽 안에서 시작한 선분이 닿지 않았습니다");
        Equal(inside.Tile, tile);
        Equal(inside.Fraction, Fixed.Zero);

        // 벽 면(x = 480) 바로 앞에서 끝나면 닿지 않고, 벽 면에서 끝나면 끝점(비율 1)에서 닿는다.
        FixedVector approach = FixedVector.FromInt(400, 500);
        FixedVector beforeFace = FixedVector.FromInt(479, 500);
        FixedVector onFace = FixedVector.FromInt(480, 500);
        WallHit stopsShort = map.RayWall(approach, beforeFace);
        Check(!stopsShort.Hit, "벽 앞에서 끝난 선분이 닿았습니다");
        WallHit reachesFace = map.RayWall(approach, onFace);
        Check(reachesFace.Hit, "벽 면에서 끝난 선분이 닿지 않았습니다");
        Equal(reachesFace.Tile, tile);
        Equal(reachesFace.Fraction, Fixed.One);
    }

    private static void Cover()
    {
        Fixture f = new Fixture();
        f.Player.Position = FixedVector.FromInt(464, 498);
        f.Player.Aim = Angle.FromRadians(313 * Math.PI / 180);
        Enemy enemy = Target(f);
        enemy.Position = FixedVector.FromInt(495, 465);
        Check(f.Match.Map.CanStand(f.Player.Position, Rules.PlayerRadius));
        Check(f.Match.Map.CanStand(enemy.Position, enemy.Definition.Radius));
        Check(!f.Match.Map.LineOfSight(f.Player.Position, enemy.Position));
        Prepare(f, f.Player, "strike");
        Advance(f.Match, 0.3);
        Near(enemy.Hp, 1);

        // 적이 다른 쪽을 공격하는 중이어도 같다. 대원은 그 공격의 범위 밖이라 닿았다면 측면 공격으로 쳤겠지만, 벽 모서리에 가려 닿지 않는다.
        Fixture busy = new Fixture();
        busy.Player.Position = FixedVector.FromInt(464, 498);
        busy.Player.Aim = Angle.FromRadians(313 * Math.PI / 180);
        Enemy attacking = Target(busy);
        attacking.Position = FixedVector.FromInt(495, 465);
        BeginAction(busy, attacking, EnemyDefinition.Grunt.Skills[0], 0.5);
        Prepare(busy, busy.Player, "strike");
        Advance(busy.Match, 0.3);
        Near(attacking.Hp, 1);
        Near(busy.Player.Hp, busy.Player.MaxHp);
    }

    private static void SightPerPlayer()
    {
        // 서 있는 분쇄자(체력 2)를 두 대원이 같은 순간에 회전 베기로 친다. 한 대원은 벽 모서리에 가려 있고 다른 대원은 트인 곳에 있다.
        // 트인 곳의 대원만 친다. 판정은 대원과 적 사이의 사선을 한 번만 따라가 기억하는데(PR #28 리뷰 7번), 대원이 바뀔 때
        // 그 기억을 버리지 않으면 앞 대원의 사선으로 뒤 대원을 판정한다. 그래서 대원 순서를 바꿔도 결과가 같은지 본다.
        SkillDefinition spin = Rules.FindSkill("spin")!;
        for (int reversed = 0; reversed < 2; reversed++)
        {
            Fixture f = new Fixture();
            Enemy enemy = Target(f, EnemyDefinition.Breaker);
            enemy.Position = FixedVector.FromInt(495, 465);
            f.Player.Position = FixedVector.FromInt(464, 498);
            Check(!f.Match.Map.LineOfSight(f.Player.Position, enemy.Position), "벽에 가린 자리가 아닙니다");
            // 적에게서 40 떨어진 자리 가운데 대원이 설 수 있고 사선이 열린 곳을 찾아 동료를 둔다.
            Player ally = Ally(f, "ally");
            bool placed = false;
            for (int i = 0; i < 16; i++)
            {
                FixedVector spot = enemy.Position + Angle.FromFraction(i, 16).Direction() * 40;
                if (f.Match.Map.CanStand(spot, Rules.PlayerRadius) && f.Match.Map.LineOfSight(spot, enemy.Position))
                {
                    ally.Position = spot;
                    placed = true;
                    break;
                }
            }
            Check(placed, "사선이 열린 자리를 찾지 못했습니다");
            if (reversed == 1)
            {
                f.Match.Players.Reverse();
            }
            Prepare(f, f.Player, spin, spin.AuraSeconds);
            Prepare(f, ally, spin, spin.AuraSeconds);
            Advance(f.Match, Rules.Step);
            Near(enemy.Hp, 1);
            Equal(ally.Kills + f.Player.Kills, 0);
        }
    }

    private static void Structures()
    {
        Fixture f = new Fixture();
        f.Player.Position = FixedVector.FromInt(680, 500);
        f.Player.Mana = 12;
        // 틱마다 타격을 짧게 누른다. 앞의 타격이 끝난 틱의 누름으로 다음 타격이 시작된다.
        for (int i = 0; i < 70; i++)
        {
            f.Match.Input(f.Player, i, 0, 0, 0, Slots(0), Slots(1));
            f.Match.Step();
        }
        Check(!f.Match.Map.Solid(15, 10));
        Check(!f.Match.Map.Damage(0, 100));
        f.Player.Position = f.Match.Facilities[0].Position - FixedVector.FromInt(55, 0);
        for (int i = 70; i < 170; i++)
        {
            f.Match.Input(f.Player, i, 0, 0, 0, Slots(0), Slots(1));
            f.Match.Step();
        }
        Near(f.Match.Facilities[0].Hp, 0);
    }

    private static void WallHitEffect()
    {
        // 오른쪽 벽(왼쪽 면 x = 720)을 마주 보고 한 번 친다. 부술 수 있는 벽은 체력이 3이라 한 번에 부서지지 않는다.
        Fixture f = new Fixture();
        f.Player.Position = FixedVector.FromInt(680, 500);
        f.Player.Aim = Angle.Zero;
        f.Player.Mana = 1;
        f.Match.Input(f.Player, 1, 0, 0, 0, Slots(0), Slots(1));
        Advance(f.Match, 0.3);
        Check(f.Match.Map.Solid(15, 10), "한 번에 벽이 부서졌습니다");
        // 시설을 칠 때처럼 벽을 칠 때도 효과가 보여야 한다. 스냅샷에는 시야 안의 효과만 담긴다.
        SnapshotMessage shared = Snapshot.CreateShared(f.Match);
        int visible = 0;
        for (int i = 0; i < shared.Effects.Count; i++)
        {
            EffectSnapshot effect = shared.Effects[i];
            if (effect.Kind == "hit" && effect.X > 680 && effect.X < 720)
            {
                visible++;
            }
        }
        Equal(visible, 1);
    }

    private static void Bodies()
    {
        Fixture f = new Fixture();
        Enemy enemy = Target(f);
        f.Player.Mana = 5;
        for (int i = 0; i < 20; i++)
        {
            f.Match.Input(f.Player, i, 1, 0, Math.PI, Slots(0), Slots(2));
            f.Match.Step();
        }
        Check(f.Player.Position.X > Fixed.FromInt(300));
        Check(f.Player.Position.X <= enemy.Position.X - enemy.Definition.Radius - Rules.PlayerRadius + Fixed.FromRaw(4));
        Check(f.Player.Mana < 5);
        Fixture moving = new Fixture();
        Enemy lead = new Enemy(1, FixedVector.FromInt(390, 730), EnemyDefinition.Grunt);
        Enemy following = new Enemy(2, FixedVector.FromInt(420, 730), EnemyDefinition.Grunt);
        moving.Match.Enemies.Add(lead);
        moving.Match.Enemies.Add(following);
        for (int i = 0; i < 90; i++)
        {
            moving.Match.Step();
            Check(Distance(lead.Position, following.Position) >= 26 - 0.001);
            Check(Distance(lead.Position, moving.Player.Position) >= 26 - 0.001);
        }
    }

    private static void SkillTimeErrors()
    {
        // 틀린 시간마다 그 값의 이름과 값으로 알린다(PR #28 리뷰 6번). 두 조건을 한 번에 보던 때에는 장판 시간이 음수여도
        // 예외가 기운 시간의 이름과 정상 값(0.2)을 가리켰다. 정적 기술 정의에서 나면 형식 초기화 예외 안에 그 이름과 값만 남는다.
        ArgumentOutOfRangeException zone = SkillError(0.2, -0.1, 1);
        Equal(zone.ParamName, "zoneSeconds");
        Equal(zone.ActualValue, (object)(-0.1));
        ArgumentOutOfRangeException aura = SkillError(-0.3, 0.2, 1);
        Equal(aura.ParamName, "auraSeconds");
        Equal(aura.ActualValue, (object)(-0.3));
        // 기술 전체의 길이가 기운과 장판을 합친 시간보다 짧으면 길이를 가리킨다.
        ArgumentOutOfRangeException duration = SkillError(0.2, 0.3, 0.4);
        Equal(duration.ParamName, "duration");
        Equal(duration.ActualValue, (object)0.4);
        // 맞는 값은 받는다. 0.1 + 0.2는 실수로는 0.3보다 조금 크지만 틱으로는 같은 9틱이다.
        SkillDefinition valid = new SkillDefinition("test", "strike", 1, 0.1, 0.2, 0.3, 50, 20, false, false, false, false);
        Equal(valid.Duration, 0.3);
    }

    // 주어진 시간으로 기술 정의를 만들 때 나는 예외를 돌려준다. 예외가 나지 않으면 검사가 실패한다.
    private static ArgumentOutOfRangeException SkillError(double auraSeconds, double zoneSeconds, double duration)
    {
        try
        {
            SkillDefinition unused = new SkillDefinition("test", "strike", 1, auraSeconds, zoneSeconds, duration, 50, 20, false, false, false, false);
        }
        catch (ArgumentOutOfRangeException error)
        {
            return error;
        }
        throw new Exception("범위를 벗어난 시간인데 예외가 나지 않았습니다");
    }

    // 같은 수치와 속성에 id만 바꾼 새 기술을 만든다.
    private static SkillDefinition Renamed(SkillDefinition skill, string id)
    {
        return new SkillDefinition(id, skill.Kind, skill.Mana, skill.AuraSeconds, skill.ZoneSeconds,
            skill.Duration, skill.Range, skill.HalfWidth, skill.PlainZone,
            skill.SingleTarget, skill.BreaksStructures, skill.Around);
    }

    private static PlayerAction Use(Fixture f, SkillDefinition skill, int id)
    {
        PlayerAction action = new PlayerAction(id, skill, 1, f.Match.Tick, Rules.ToTicks(f.Match.Rules.MaxAuraSeconds));
        // 입력 없이 만든 기술이라 버튼은 누르고 있지 않다.
        action.Released = true;
        f.Player.Actions.Add(action);
        return action;
    }

    private static void SkillFlags()
    {
        // 판정이 id 문자열에 묶여 있으면, id만 다른 새 기술은 아래 동작을 조용히 잃는다.
        Rules rules = new Rules();
        SkillDefinition shield = Renamed(rules.Parry, "shield");
        SkillDefinition hook = Renamed(rules.Grab, "hook");
        SkillDefinition smash = Renamed(rules.Strike, "smash");

        // 기운은 앞 120°로 돈다. 조준에서 40도 벗어난 곳의 타격 장판도 받아친다. 좁은 장판으로는 닿지 않는 곳이다.
        Fixture guarded = new Fixture();
        Enemy striker = Target(guarded);
        double side = 40 * Math.PI / 180;
        striker.Position = guarded.Player.Position + Angle.FromRadians(side).Direction() * 50;
        striker.Action = new EnemyAction(30010, new EnemySkill("strike", 1, 0, 0.05, 85, 25), Angle.FromRadians(side + Math.PI), guarded.Match.Tick);
        Use(guarded, shield, 30011);
        Advance(guarded.Match, 0.08);
        Near(striker.Hp, 0);
        Near(guarded.Player.Hp, 6);

        // 상성 없는 장판: 기운이 도는 동안에는 무행동인 적을 치지 않고, 기운이 끝나면 일반 반격이 장판으로 나간다.
        Fixture countered = new Fixture();
        Enemy idle = Target(countered);
        Use(countered, shield, 30012);
        Advance(countered.Match, 0.3);
        Near(idle.Hp, 1);
        Advance(countered.Match, shield.AuraSeconds - 0.3 + 0.1);
        Near(idle.Hp, 0);

        // 상성 없는 장판은 그것을 이기는 기운(잡기)을 두른 적에게 닿아도 당하지 않고 일반 피해 1을 준다.
        // 같은 자리에서 방어 상성의 장판(회전 방어)이 닿으면 적의 완벽 대응이라 대원만 피해를 받는다.
        Fixture plain = new Fixture();
        Enemy grabber = Threat(plain, "channel", 2, arrivesIn: 2);
        PlayerAction counter = Prepare(plain, plain.Player, shield, shield.AuraSeconds);
        Check(counter.ZoneOut(plain.Match.Tick + 1), "반격 장판이 나갈 틱이 아닙니다");
        Advance(plain.Match, Rules.Step);
        Near(grabber.Hp, 1);
        Near(plain.Player.Hp, 6);
        Fixture affine = new Fixture();
        Enemy winner = Threat(affine, "channel", 2, arrivesIn: 2);
        SkillDefinition spinBlock = Rules.FindSkill("spinblock")!;
        PlayerAction lost = Prepare(affine, affine.Player, spinBlock, spinBlock.AuraSeconds);
        Advance(affine.Match, Rules.Step);
        Near(winner.Hp, 2);
        Near(affine.Player.Hp, 4);
        Check(Gone(affine.Player, lost), "잡기의 기운에 진 방어 장판이 끊기지 않았습니다");

        // 단일 대상: 범위 안에 둘이 있어도 가까운 한 명만 판정한다.
        Fixture held = new Fixture();
        Enemy near = Target(held);
        Enemy far = Target(held);
        near.Position = held.Player.Position + FixedVector.FromInt(40, 0);
        far.Position = held.Player.Position + FixedVector.FromInt(58, 0);
        Use(held, hook, 30013);
        Advance(held.Match, 0.2);
        Near(near.Hp, 0);
        Near(far.Hp, 1);

        // 구조물 파괴: 장판이 시설을 부순다.
        Fixture breaker = new Fixture();
        Facility facility = breaker.Match.Facilities[0];
        breaker.Player.Position = facility.Position - FixedVector.FromInt(40, 0);
        Use(breaker, smash, 30014);
        Advance(breaker.Match, 0.25);
        Near(facility.Hp, facility.MaxHp - 1);

        // 상성 없는 장판(반격)의 구조물 파괴도 같은 속성으로 정한다. 받아치기를 본뜬 기술의 반격은 시설을 부순다.
        Fixture countering = new Fixture();
        Facility struck = countering.Match.Facilities[0];
        countering.Player.Position = struck.Position - FixedVector.FromInt(40, 0);
        Use(countering, shield, 30015);
        Advance(countering.Match, shield.AuraSeconds + 0.1);
        Near(struck.Hp, struck.MaxHp - 1);

        // 반격은 있지만 구조물은 부수지 않는 기술은 시설을 그대로 둔다.
        SkillDefinition deflect = new SkillDefinition("deflect", rules.Parry.Kind, rules.Parry.Mana, rules.Parry.AuraSeconds,
            rules.Parry.ZoneSeconds, rules.Parry.Duration, rules.Parry.Range, rules.Parry.HalfWidth,
            plainZone: true, singleTarget: false, breaksStructures: false, around: false);
        Fixture deflecting = new Fixture();
        Facility kept = deflecting.Match.Facilities[0];
        deflecting.Player.Position = kept.Position - FixedVector.FromInt(40, 0);
        Use(deflecting, deflect, 30016);
        Advance(deflecting.Match, deflect.AuraSeconds + 0.1);
        Near(kept.Hp, kept.MaxHp);

        // 기술의 길이는 기운과 장판을 합친 시간보다 짧을 수 없다.
        Throws<ArgumentOutOfRangeException>(() => new SkillDefinition("short", "strike", 1, 0.3, 0.3, 0.5, 54, 10, false, false, true, false));
    }

    private static void AroundSkills()
    {
        // 둘레 기술 셋은 상성 종류만 다르고 나머지 동작은 같다. 판정이 id에 묶이지 않았는지 보려고 id만 바꾼 정의를 쓴다.
        Rules rules = new Rules();
        SkillDefinition[] around = new SkillDefinition[]
        {
            Renamed(Rules.FindSkill("spin")!, "whirl"), Renamed(Rules.FindSkill("spinblock")!, "whirl-block"),
            Renamed(Rules.FindSkill("spingrab")!, "whirl-grab")
        };
        for (int s = 0; s < around.Length; s++)
        {
            SkillDefinition skill = around[s];

            // 둘레 네 방향의 무행동 적을 한 번에 모두 친다. 반지름(48)에 적의 몸(13)을 더한 거리 밖의 적은 맞지 않는다.
            Fixture spun = new Fixture();
            Enemy[] ring = new Enemy[4];
            for (int i = 0; i < ring.Length; i++)
            {
                ring[i] = Target(spun);
                ring[i].Position = spun.Player.Position + Angle.FromFraction(i, ring.Length).Direction() * 50;
            }
            Enemy beyond = Target(spun);
            beyond.Position = spun.Player.Position + Angle.FromFraction(1, 8).Direction() * 70;
            Prepare(spun, spun.Player, skill);
            Advance(spun.Match, 0.3);
            for (int i = 0; i < ring.Length; i++)
            {
                Near(ring[i].Hp, 0);
            }
            Near(beyond.Hp, 1);

            // 둘레의 원도 벽 너머에는 닿지 않는다. Cover와 같은 자리라 원 안이지만 두 몸 중심 사이의 사선이 벽 모서리에 가린다.
            Fixture covered = new Fixture();
            covered.Player.Position = FixedVector.FromInt(464, 498);
            Enemy hidden = Target(covered);
            hidden.Position = FixedVector.FromInt(495, 465);
            Check(Distance(covered.Player.Position, hidden.Position) < 48 + 13, "적이 원 밖에 있습니다");
            Check(!covered.Match.Map.LineOfSight(covered.Player.Position, hidden.Position));
            Prepare(covered, covered.Player, skill);
            Advance(covered.Match, 0.3);
            Near(hidden.Hp, 1);

            // 둘레의 시설을 부순다. 시설이 등 뒤에 있어도 된다.
            Fixture razing = new Fixture();
            Facility razed = razing.Match.Facilities[0];
            razing.Player.Position = razed.Position - FixedVector.FromInt(40, 0);
            razing.Player.Aim = Angle.FromRadians(Math.PI);
            Prepare(razing, razing.Player, skill);
            Advance(razing.Match, 0.3);
            Near(razed.Hp, razed.MaxHp - 1);

            // 벽은 조준 방향으로만 친다. 부술 수 있는 벽(체력 3) 바로 옆에서 세 번 써도 벽은 그대로다.
            // 같은 자리에서 근접 타격으로 치면 부서진다(Structures, WallHitEffect).
            Fixture walled = new Fixture();
            walled.Player.Position = FixedVector.FromInt(680, 500);
            for (int i = 0; i < 3; i++)
            {
                Prepare(walled, walled.Player, skill);
                Advance(walled.Match, skill.Duration + 0.05);
            }
            Check(walled.Match.Map.Solid(15, 10), $"{skill.Id}: 둘레 기술이 벽을 쳤습니다");
        }

        // 상성은 종류대로 따른다. 병사가 대원의 등 뒤(오른쪽)에서 대원 쪽으로 친다. 둘레 기술의 기운은 모든 방향으로 돈다.
        // 회전 방어는 이긴다. 예고 장판 안에서 기운을 두른 순간 완벽 대응이라 병사만 쓰러진다.
        // 회전 베기는 같은 종류라 장판이 나가 닿을 때 비긴다(서로 1). 회전 잡기는 그때 진다(대원만 1을 잃음).
        double[] strikerHp = new double[] { 0, 0, 1 };
        double[] playerLoss = new double[] { 1, 0, 1 };
        for (int s = 0; s < around.Length; s++)
        {
            Fixture behind = new Fixture();
            Enemy striker = Threat(behind, "strike");
            behind.Player.Aim = Angle.FromRadians(Math.PI);
            Prepare(behind, behind.Player, around[s]);
            Advance(behind.Match, 0.1);
            Near(striker.Hp, strikerHp[s]);
            Near(behind.Player.Hp, behind.Player.MaxHp - playerLoss[s]);
        }

        // 조준 방향의 근접 타격은 등 뒤의 시설에 닿지 않는다.
        Fixture missing = new Fixture();
        Facility untouched = missing.Match.Facilities[0];
        missing.Player.Position = untouched.Position - FixedVector.FromInt(40, 0);
        missing.Player.Aim = Angle.FromRadians(Math.PI);
        Prepare(missing, missing.Player, rules.Strike);
        Advance(missing.Match, 0.3);
        Near(untouched.Hp, untouched.MaxHp);

        // 둘레 기술의 기운은 모든 방향으로 돈다. 장판이 없는 둘레 방어(기운만 있는 기술)로 속성의 뜻을 따로 지킨다.
        // 등 뒤에서 오는 타격에 받아치기의 기운은 앞(120°)으로만 돌아 대응하지 못하고 맞는다. 둘레 방어는 받아쳐 이긴다.
        SkillDefinition ringGuard = new SkillDefinition("ring", rules.Parry.Kind, rules.Parry.Mana, rules.Parry.AuraSeconds,
            0, rules.Parry.Duration, 0, 0, plainZone: false, singleTarget: false, breaksStructures: false, around: true);
        Fixture facingAway = new Fixture();
        Enemy unblocked = Threat(facingAway, "strike");
        facingAway.Player.Aim = Angle.FromRadians(Math.PI);
        Prepare(facingAway, facingAway.Player, rules.Parry);
        Advance(facingAway.Match, 0.1);
        Near(unblocked.Hp, 1);
        Near(facingAway.Player.Hp, facingAway.Player.MaxHp - 1);

        Fixture guarded = new Fixture();
        Enemy blocked = Threat(guarded, "strike");
        guarded.Player.Aim = Angle.FromRadians(Math.PI);
        Prepare(guarded, guarded.Player, ringGuard);
        Advance(guarded.Match, 0.1);
        Near(blocked.Hp, 0);
        Near(guarded.Player.Hp, guarded.Player.MaxHp);
    }

    private static void AuraReach()
    {
        // 기술을 시작하면 장판이 나가기 전까지 대원 몸에 그 기술의 기운이 돈다. 적의 장판(예고 중인 장판 포함)이 대원을 덮고
        // 기운이 그 적 쪽(둘레 기술은 모든 방향, 그 밖에는 앞 120°)을 향하면 기술의 사거리와 관계없이 그 상성으로 판정한다.
        // 병사의 잡기 장판은 75(62 + 대원 몸 13), 밀어치기는 75(62 + 13), 타격은 78(65 + 13)까지 닿는다.
        // 대원의 근접 타격 장판은 앞으로 67(54 + 병사 몸 13), 잡기와 회전 베기는 61(48 + 13)까지 닿는다.
        EnemySkill strike = EnemyDefinition.Grunt.Skills[0];
        EnemySkill shove = EnemyDefinition.Grunt.Skills[1];
        EnemySkill grab = EnemyDefinition.Grunt.Skills[2];
        Equal(grab.Kind, "channel");
        Equal(shove.Kind, "block");

        // 앞에서 70 떨어진 병사가 잡기를 예고한다. 근접 타격의 장판은 닿지 않는 거리지만 타격의 기운이 잡기 장판을 이긴다.
        // 예고 중에 바로 판정이 나 병사가 쓰러지고, 근접 타격은 장판 없이 거기서 끝난다.
        Fixture ahead = new Fixture();
        Enemy grabber = Threat(ahead, EnemyDefinition.Grunt, grab, 0.5);
        grabber.Position = ahead.Player.Position + FixedVector.FromInt(70, 0);
        PlayerAction won = Prepare(ahead, ahead.Player, "strike");
        Advance(ahead.Match, Rules.Step);
        Near(grabber.Hp, 0);
        Near(ahead.Player.Hp, ahead.Player.MaxHp);
        Check(Gone(ahead.Player, won), "완벽 대응을 낸 근접 타격이 끝나지 않았습니다");
        Equal(ahead.Player.Actions.Count, 0);

        // 같은 잡기가 등 뒤에서 오면 근접 타격의 기운은 대응하지 못한다. 장판이 나가 닿을 때 대원이 맞고 기술이 끊긴다.
        Fixture behind = new Fixture();
        Enemy rear = Threat(behind, EnemyDefinition.Grunt, grab);
        rear.Position = behind.Player.Position + FixedVector.FromInt(70, 0);
        behind.Player.Aim = Angle.FromRadians(Math.PI);
        PlayerAction swing = Prepare(behind, behind.Player, "strike");
        Advance(behind.Match, 0.1);
        Near(rear.Hp, 1);
        Near(behind.Player.Hp, behind.Player.MaxHp - 1);
        Check(Gone(behind.Player, swing), "등 뒤에서 잡힌 근접 타격이 끊기지 않았습니다");

        // 둘레 기술의 기운은 모든 방향이다. 등 뒤 65에서 잡는 병사를 회전 베기가 이긴다(2026-10-31 KYWN3F 방에서 제보한 장면).
        Fixture spun = new Fixture();
        Enemy far = Threat(spun, EnemyDefinition.Grunt, grab);
        far.Position = spun.Player.Position + FixedVector.FromInt(65, 0);
        spun.Player.Aim = Angle.FromRadians(Math.PI);
        Prepare(spun, spun.Player, "spin");
        Advance(spun.Match, 0.1);
        Near(far.Hp, 0);
        Near(spun.Player.Hp, spun.Player.MaxHp);

        // 장판이 대원을 덮지 않으면 기운은 받아치지 못한다. 80 떨어진 병사의 잡기 장판(75)은 대원에게 닿지 않는다.
        // 근접 타격의 장판(67)도 병사에게 닿지 않아 아무 일도 없다.
        Fixture outside = new Fixture();
        Enemy distant = Threat(outside, EnemyDefinition.Grunt, grab, 0.5);
        distant.Position = outside.Player.Position + FixedVector.FromInt(80, 0);
        PlayerAction missed = Prepare(outside, outside.Player, "strike");
        Advance(outside.Match, 0.4);
        Near(distant.Hp, 1);
        Near(outside.Player.Hp, outside.Player.MaxHp);
        Check(!Gone(outside.Player, missed), "장판 밖의 기운이 판정받았습니다");

        // 앞에서 70 떨어진 병사의 밀어치기를 잡기의 기운이 이긴다. 잡기는 그 병사를 대상으로 정한다.
        Fixture held = new Fixture();
        Enemy shover = Threat(held, EnemyDefinition.Grunt, shove);
        shover.Position = held.Player.Position + FixedVector.FromInt(70, 0);
        PlayerAction hold = Prepare(held, held.Player, "grab");
        Advance(held.Match, 0.1);
        Near(shover.Hp, 0);
        Near(held.Player.Hp, held.Player.MaxHp);
        Equal(hold.Target, shover.Id);

        // 잡기는 한 시전에 한 명만 판정하므로, 잡기의 기운도 장판 하나만 받아친다. 앞 60과 70에서 병사 둘이 함께 밀어치기를
        // 예고하면 가까운 병사만 쓰러지고 잡기는 끝난다. 회전 잡기의 기운은 둘 다 받아친다.
        Fixture single = new Fixture();
        Enemy closer = Threat(single, EnemyDefinition.Grunt, shove, 0.5);
        closer.Position = single.Player.Position + FixedVector.FromInt(60, 0);
        Enemy farther = Threat(single, EnemyDefinition.Grunt, shove, 0.5);
        farther.Position = single.Player.Position + FixedVector.FromInt(70, 0);
        PlayerAction one = Prepare(single, single.Player, "grab");
        Advance(single.Match, 0.3);
        Near(closer.Hp, 0);
        Near(farther.Hp, 1);
        Equal(one.Target, closer.Id);
        Near(single.Player.Hp, single.Player.MaxHp);
        Fixture every = new Fixture();
        Enemy left = Threat(every, EnemyDefinition.Grunt, shove, 0.5);
        left.Position = every.Player.Position + FixedVector.FromInt(60, 0);
        Enemy right = Threat(every, EnemyDefinition.Grunt, shove, 0.5);
        right.Position = every.Player.Position + FixedVector.FromInt(70, 0);
        Prepare(every, every.Player, "spingrab");
        Advance(every.Match, Rules.Step);
        Near(left.Hp, 0);
        Near(right.Hp, 0);

        // 잡기의 장판이 이미 다른 적을 잡았으면 기운은 끝난 뒤다. 가까이 서 있던 병사를 장판으로 잡은 뒤에
        // 다른 병사의 밀어치기가 닿으면 대응하지 못하고 맞는다.
        Fixture busy = new Fixture();
        Enemy first = Target(busy);
        first.Position = busy.Player.Position + FixedVector.FromInt(40, 0);
        PlayerAction taken = Prepare(busy, busy.Player, "grab", busy.Match.Rules.Grab.AuraSeconds);
        Advance(busy.Match, Rules.Step);
        Near(first.Hp, 0);
        Enemy second = Threat(busy, EnemyDefinition.Grunt, shove);
        second.Position = busy.Player.Position + FixedVector.FromInt(70, 0);
        Advance(busy.Match, 0.1);
        Near(second.Hp, 1);
        Near(busy.Player.Hp, busy.Player.MaxHp - 1);
        Check(Gone(busy.Player, taken), "다른 병사를 잡은 잡기가 밀어치기에 끊기지 않았습니다");

        // 같은 종류면 비긴다. 앞에서 72 떨어진 병사의 타격 장판이 나가 닿을 때 근접 타격의 기운을 두르고 있으면 서로 1씩 잃는다.
        Fixture even = new Fixture();
        Enemy striker = Threat(even, EnemyDefinition.Grunt, strike);
        striker.Position = even.Player.Position + FixedVector.FromInt(72, 0);
        Prepare(even, even.Player, "strike");
        Advance(even.Match, 0.1);
        Near(striker.Hp, 0);
        Near(even.Player.Hp, even.Player.MaxHp - 1);
    }

    private static void GrabTargetOrder()
    {
        // 가까이(40) 서 있기만 한 병사 C와, 앞 70에서 밀어치기를 예고하는 병사 B가 있다. 잡기의 기운은 대원을 덮은
        // 밀어치기 장판을 받아쳐 B를 쓰러뜨리고 거기서 끝난다. C는 대상이 아니라 그대로다. 적 목록의 순서를 바꿔도 같아야 한다.
        EnemySkill shove = EnemyDefinition.Grunt.Skills[1];
        for (int reversed = 0; reversed < 2; reversed++)
        {
            Fixture f = new Fixture();
            Enemy idle = Target(f);
            idle.Position = f.Player.Position + FixedVector.FromInt(40, 0);
            // 잡기의 장판은 시작 0.12초 뒤에 나간다. 밀어치기도 같은 틱에 나가게 해 둔다. 판정은 그 전에 기운으로 난다.
            Enemy shover = Threat(f, EnemyDefinition.Grunt, shove, f.Match.Rules.Grab.AuraSeconds);
            shover.Position = f.Player.Position + FixedVector.FromInt(70, 0);
            if (reversed == 1)
            {
                f.Match.Enemies.Reverse();
            }
            PlayerAction grab = Prepare(f, f.Player, "grab");
            Advance(f.Match, 0.3);
            Near(shover.Hp, 0);
            Near(idle.Hp, 1);
            Near(f.Player.Hp, f.Player.MaxHp);
            Equal(grab.Target, shover.Id);
        }
    }

    private static void GrabFlankedTarget()
    {
        // 잡기의 기운을 두른 순간 앞 70의 병사 E가 밀어치기를 예고하고 있다. 같은 순간 동료의 장판이 E의 뒤에서 닿아(측면 공격)
        // E가 쓰러지면 그 장판은 무효다. 잡기는 E와 판정하지 않았으므로 E에게 묶이지 않고 끝나지도 않는다.
        // 장판이 나가는 순간 가까이(40) 서 있던 병사 F를 잡는다.
        EnemySkill shove = EnemyDefinition.Grunt.Skills[1];
        Fixture f = new Fixture();
        Enemy near = Target(f);
        near.Position = f.Player.Position + FixedVector.FromInt(40, 0);
        Enemy shover = Threat(f, EnemyDefinition.Grunt, shove);
        shover.Position = f.Player.Position + FixedVector.FromInt(70, 0);
        Player partner = Ally(f, "partner");
        partner.Position = shover.Position + FixedVector.FromInt(40, 0);
        partner.Aim = Angle.FromRadians(Math.PI);
        // 동료의 타격 장판이 다음 틱에 나가도록 그만큼 먼저 시작한 타격이다. 잡기의 기운이 E의 장판을 처음 만나는 틱과 같다.
        PlayerAction flank = Prepare(f, partner, "strike", f.Match.Rules.Strike.AuraSeconds - Rules.Step);
        Equal(flank.ZoneTick, f.Match.Tick + 1);
        PlayerAction grab = Prepare(f, f.Player, "grab");
        Advance(f.Match, Rules.Step);
        Near(shover.Hp, 0);
        Equal(partner.Kills, 1);
        Check(!Gone(f.Player, grab), "측면 공격으로 쓰러진 적에게 잡기가 완벽 대응을 냈습니다");
        Advance(f.Match, 0.3);
        Near(f.Player.Hp, f.Player.MaxHp);
        Near(near.Hp, 0);
        Equal(grab.Target, near.Id);
    }

    private static void SimultaneousHits()
    {
        // 같은 순간에 닿은 장판은 모두 그 순간이 시작할 때의 대원 상태로 판정한다. 기술이 끝나거나 끊기는 것과 쓰러지는 것은 그 뒤다.
        // 적 목록 순서를 바꿔 두 번씩 돌려 결과가 같은지 본다.
        EnemySkill shove = EnemyDefinition.Grunt.Skills[1];
        EnemySkill grab = EnemyDefinition.Grunt.Skills[2];
        double[] startHps = new double[] { 6, 1 };
        for (int h = 0; h < startHps.Length; h++)
        {
            for (int reversed = 0; reversed < 2; reversed++)
            {
                // 회전 베기의 기운을 두른 순간, 앞(+x) 병사의 잡기 장판(회전 베기가 이김)과 뒤(-x) 병사의 밀어치기 장판(회전 베기가 짐)이
                // 함께 나가 닿는다. 두 장판 모두 다음 틱에 나간다.
                Fixture f = new Fixture();
                f.Player.Hp = startHps[h];
                Enemy grabber = Target(f);
                grabber.Position = f.Player.Position + FixedVector.FromInt(60, 0);
                BeginAction(f, grabber, grab, Rules.Step);
                Enemy shover = Target(f);
                shover.Position = f.Player.Position + FixedVector.FromInt(-60, 0);
                BeginAction(f, shover, shove, Rules.Step, 0);
                if (reversed == 1)
                {
                    f.Match.Enemies.Reverse();
                }
                PlayerAction spin = Prepare(f, f.Player, "spin");
                Advance(f.Match, 0.3);
                // 잡는 병사는 언제나 쓰러진다. 대원은 밀어치기에만 1을 잃고, 회전 베기는 그 뒤에 끝난다(이긴 판정과 진 판정이 함께 났다).
                // 체력이 1이었으면 대원은 쓰러지지만, 같은 순간의 잡기는 이미 이긴 판정이다.
                Near(grabber.Hp, 0);
                Near(shover.Hp, 1);
                Near(f.Player.Hp, startHps[h] - 1);
                if (startHps[h] > 1)
                {
                    // 이긴 판정(잡는 병사 처치)과 진 판정(대원 -1)은 위에서 봤다. 기술은 그 순간 목록에서 빠진다.
                    Check(Gone(f.Player, spin), "밀어치기에 진 회전 베기가 끊기지 않았습니다");
                    Equal(f.Player.Actions.Count, 0);
                    Equal(f.Player.State, "alive");
                }
                else
                {
                    Equal(f.Player.State, "waiting");
                }
            }
        }

        // 동료(체력 1)가 같은 순간 다른 병사 C의 밀어치기에 맞아 쓰러진다. 그 순간 동료의 장판이 병사 B를 옆에서 친 타격은 그대로 들어가
        // B가 쓰러지고, B가 대원에게 하던 잡기는 무효다(상성 없는 타격). 동료가 먼저 쓰러졌다고 그 타격이 사라지지 않는다.
        for (int reversed = 0; reversed < 2; reversed++)
        {
            Fixture f = new Fixture();
            Player partner = Ally(f, "partner");
            partner.Position = f.Player.Position + FixedVector.FromInt(0, 30);
            partner.Hp = 1;
            Enemy b = Target(f);
            b.Position = f.Player.Position + FixedVector.FromInt(45, 0);
            BeginAction(f, b, grab, f.Match.Rules.Strike.AuraSeconds);
            Enemy c = Target(f);
            c.Position = f.Player.Position + FixedVector.FromInt(0, 80);
            BeginAction(f, c, shove, f.Match.Rules.Strike.AuraSeconds, -Math.PI / 2);
            if (reversed == 1)
            {
                f.Match.Enemies.Reverse();
            }
            // 동료는 B를 향해 친다. B의 잡기 장판 밖이라 동료의 기운은 그 장판을 받아치지 않고, 동료의 장판이 나갈 때 상성 없이 친다.
            // C는 동료의 등 뒤라 동료의 기운이 향하지 않는다.
            partner.Aim = Angle.FromRadians(Math.Atan2(-30, 45));
            Prepare(f, partner, "strike");
            Advance(f.Match, 0.3);
            Near(b.Hp, 0);
            Equal(partner.State, "waiting");
            Near(f.Player.Hp, f.Player.MaxHp);
        }
    }

    private static void Flank()
    {
        // B를 향해 방어를 예고하는 적을 A가 뒤에서 친다. 방패가 A를 향하지 않으므로 상성 없이 일반 피해만 준다.
        Fixture shielded = new Fixture();
        Player front = Ally(shielded, "front");
        Enemy blocker = Target(shielded);
        blocker.Position = FixedVector.FromInt(420, 730);
        front.Position = FixedVector.FromInt(380, 730);
        shielded.Player.Position = FixedVector.FromInt(460, 730);
        shielded.Player.Aim = Angle.FromRadians(Math.PI);
        blocker.Action = new EnemyAction(30050, new EnemySkill("block", 1, 0, 1, 62, 15), Angle.FromRadians(Math.PI), shielded.Match.Tick);
        PlayerAction behind = Prepare(shielded, shielded.Player, "strike", 0.2);
        Advance(shielded.Match, Rules.Step);
        Near(blocker.Hp, 0);
        Near(shielded.Player.Hp, 6);
        Check(!Gone(shielded.Player, behind), "측면 공격이 패배로 취소되었습니다");

        // B를 향한 타격이 닿는 같은 틱에 A가 측면에서 쓰러뜨리면 그 공격은 무효가 되어 B도 다치지 않는다.
        Fixture flanked = new Fixture();
        Player target = Ally(flanked, "target");
        Enemy striker = Target(flanked);
        striker.Position = FixedVector.FromInt(420, 730);
        target.Position = FixedVector.FromInt(380, 730);
        flanked.Player.Position = FixedVector.FromInt(460, 730);
        flanked.Player.Aim = Angle.FromRadians(Math.PI);
        striker.Action = new EnemyAction(30051, new EnemySkill("strike", 1, 0, 0.05, 85, 25), Angle.FromRadians(Math.PI), flanked.Match.Tick - Rules.ToTicks(0.05));
        Prepare(flanked, flanked.Player, "strike", 0.2);
        Advance(flanked.Match, Rules.Step);
        Near(striker.Hp, 0);
        Near(flanked.Player.Hp, 6);
        Near(target.Hp, 6);
    }

    private static void ShoveReach()
    {
        // 방패는 왼쪽(π)을 향하고 대원은 적 몸 옆 70° 자리에 붙어 있다. 방패의 전방 120° 밖이지만 밀어치기는 닿는다.
        FixedVector beside = Angle.FromRadians(Math.PI + 1.22).Direction() * 27;
        // 대원은 적 쪽(beside의 반대 방향)을 본다.
        Angle aim = Angle.Of(-beside);

        // 밀어치기의 장판이 덮은 대원은 잡기의 기운으로 받아칠 수 있어야 한다. 잡기는 방어를 이긴다.
        Fixture grabbing = new Fixture();
        Enemy shover = Target(grabbing);
        shover.Position = FixedVector.FromInt(420, 730);
        grabbing.Player.Position = shover.Position + beside;
        grabbing.Player.Aim = aim;
        shover.Action = new EnemyAction(30052, new EnemySkill("block", 1, 0, 0.05, 62, 15), Angle.FromRadians(Math.PI), grabbing.Match.Tick - Rules.ToTicks(0.05));
        PlayerAction grab = Prepare(grabbing, grabbing.Player, "grab");
        Advance(grabbing.Match, Rules.Step);
        Check(grabbing.Match.Tick < grab.ZoneTick, "잡기의 기운이 끝났습니다");
        Near(shover.Hp, 0);
        Near(grabbing.Player.Hp, 6);

        // 같은 자리에서 방어를 예고하는 적을 타격 장판으로 치면 측면 공격이 아니다. 방어의 기운이 타격 장판을 이긴다(적의 완벽 대응).
        Fixture striking = new Fixture();
        Enemy guard = Target(striking);
        guard.Position = FixedVector.FromInt(420, 730);
        striking.Player.Position = guard.Position + beside;
        striking.Player.Aim = aim;
        guard.Action = new EnemyAction(30053, new EnemySkill("block", 1, 0, 1, 62, 15), Angle.FromRadians(Math.PI), striking.Match.Tick);
        PlayerAction strike = Prepare(striking, striking.Player, "strike", 0.2);
        Advance(striking.Match, Rules.Step);
        Near(guard.Hp, 1);
        Near(striking.Player.Hp, 5);
        Check(Gone(striking.Player, strike), "방어에 진 타격이 취소되지 않았습니다");

        // 공격 창이 열려 장판이 나간 적에게는 기운이 없다. 같은 자리에서 같은 타격 장판이 닿으면 상성 없이 일반 피해를 주고,
        // 그 피해로 쓰러지면 그 순간 나간 밀어치기는 무효다.
        Fixture open = new Fixture();
        Enemy shoving = Target(open);
        shoving.Position = FixedVector.FromInt(420, 730);
        open.Player.Position = shoving.Position + beside;
        open.Player.Aim = aim;
        shoving.Action = new EnemyAction(30054, new EnemySkill("block", 1, 0, 0.05, 62, 15), Angle.FromRadians(Math.PI), open.Match.Tick - Rules.ToTicks(0.05));
        Prepare(open, open.Player, "strike", 0.2);
        Advance(open.Match, Rules.Step);
        Near(shoving.Hp, 0);
        Near(open.Player.Hp, 6);
    }

    private static void DrawCredit()
    {
        // 같은 2티어 타격 한 번에 대원(f.Player)은 타격으로 비기고 동료(partner)는 받아치기로 부분 대응한다.
        // 엘리트는 부분 대응 피해를 먼저 받고 비김 피해 1을 받는다. 처치는 쓰러뜨린 피해를 준 대원이 가져가고,
        // 부분 대응 피해로 쓰러지면 비김 피해는 더하지 않는다. 대원이 받는 피해는 어느 경우든 같다(비긴 대원 2, 부분 대응한 동료 1).
        // 판정 결과의 효과는 어느 경우든 부분 대응과 비김이 하나씩이다. 피해를 줄 때 같은 효과를 한 번 더 만들지 않는다.
        // 경우마다 행동의 부분 대응 피해, 엘리트의 체력, 비김 피해가 마지막 피해인지다.
        // 0: 부분 대응 피해가 없어 비김 피해로 1→0. 1: 부분 대응 피해로 1→0. 2: 부분 대응 피해로 2→1, 비김 피해로 1→0.
        int[] partials = new int[] { 0, 1, 1 };
        int[] startHps = new int[] { 1, 1, 2 };
        bool[] drawFinishes = new bool[] { true, false, true };
        for (int i = 0; i < partials.Length; i++)
        {
            Fixture f = new Fixture();
            Player partner = Ally(f, "partner");
            Enemy elite = Threat(f, "strike", 2, partials[i]);
            elite.Hp = startHps[i];
            Prepare(f, f.Player, "strike");
            Prepare(f, partner, "parry");
            Advance(f.Match, 0.08);
            Near(elite.Hp, 0);
            Near(f.Player.Hp, f.Player.MaxHp - 2);
            Near(partner.Hp, partner.MaxHp - 1);
            Equal(CountEffects(f.Match, "partial"), 1);
            Equal(CountEffects(f.Match, "draw"), 1);
            if (drawFinishes[i])
            {
                Equal(f.Player.Kills, 1);
                Equal(partner.Kills, 0);
            }
            else
            {
                Equal(f.Player.Kills, 0);
                Equal(partner.Kills, 1);
            }
        }
    }

    private static void GrabRetarget()
    {
        // 처음에는 먼 적 하나만 잡기 범위에 있다.
        Fixture f = new Fixture();
        Enemy far = Target(f);
        far.Position = f.Player.Position + FixedVector.FromInt(45, 0);
        Enemy near = Target(f);
        near.Position = f.Player.Position + FixedVector.FromInt(200, 0);
        Prepare(f, f.Player, "grab");
        Advance(f.Match, Rules.Step);
        // 기운이 도는 동안(0.12초) 더 가까운 적이 들어온다. 장판이 나가는 순간 가장 가까운 적을 잡아야 한다.
        near.Position = f.Player.Position + FixedVector.FromInt(28, 0);
        Advance(f.Match, 0.15);
        Near(near.Hp, 0);
        Near(far.Hp, 1);
    }

    private static void GrabContactTarget()
    {
        // 장판이 나가기 바로 전 틱까지는 first만 잡기 범위에 있다.
        Fixture f = new Fixture();
        Enemy first = Target(f);
        first.Position = f.Player.Position + FixedVector.FromInt(58, 0);
        Enemy second = Target(f);
        second.Position = f.Player.Position + FixedVector.FromInt(200, 0);
        PlayerAction grab = Prepare(f, f.Player, "grab");
        Advance(f.Match, 0.1);
        Check(f.Match.Tick < grab.ZoneTick, "장판이 나가기 전 틱이 아닙니다");
        // 장판이 나가는 틱 직전에 second가 더 가까이 들어온다. 장판이 나가는 틱에 가장 가까운 second를 잡아야 한다.
        second.Position = f.Player.Position + FixedVector.FromInt(30, 15);
        Advance(f.Match, Rules.Step);
        Check(f.Match.Tick >= grab.ZoneTick, "장판이 나간 틱이 아닙니다");
        Near(second.Hp, 0);
        Near(first.Hp, 1);

        // 장판이 나갈 때 범위에 아무도 없으면 대상이 없다. 장판이 깔려 있는 동안 처음 범위에 들어온 적을 잡아야 한다.
        Fixture g = new Fixture();
        Enemy leaving = Target(g);
        leaving.Position = g.Player.Position + FixedVector.FromInt(45, 0);
        PlayerAction hold = Prepare(g, g.Player, "grab");
        Advance(g.Match, Rules.Step);
        leaving.Position = g.Player.Position + FixedVector.FromInt(300, 0);
        Advance(g.Match, 0.15);
        Check(hold.ZoneOut(g.Match.Tick), "잡기의 장판이 깔려 있는 틱이 아닙니다");
        Enemy arriving = Target(g);
        arriving.Position = g.Player.Position + FixedVector.FromInt(30, 0);
        Advance(g.Match, Rules.Step);
        Near(arriving.Hp, 0);
        Near(leaving.Hp, 1);
    }

    private static void LongStep()
    {
        // 서버가 가장 많이 밀렸을 때처럼 한 번에 최대 틱 수를 진행한다. 한 틱씩 따로 진행하므로
        // 짧은 예고와 공격 창을 건너뛰지 않고 기운이 장판을 받아친다.
        using RoomHost host = NewHost();
        Fixture f = new Fixture();
        Room room = new Room(f.Match, null);
        Enemy enemy = Threat(f, "strike");
        Prepare(f, f.Player, "parry");
        host.StepRoom(f.Match.Code, room, TickClock.MaxTicksPerWake, false);
        Near(enemy.Hp, 0);
        Near(f.Player.Hp, 6);
        // 밀린 틱을 몰아서 진행해도 이동 경로가 벽을 통과하지 않는다. 오른쪽 벽의 왼쪽 면은 x = 720이다.
        Fixture walker = new Fixture();
        Room walkerRoom = new Room(walker.Match, null);
        walker.Player.Position = FixedVector.FromInt(680, 500);
        walker.Match.Input(walker.Player, 1, 1, 0, 0);
        host.StepRoom(walker.Match.Code, walkerRoom, TickClock.MaxTicksPerWake, false);
        Check(walker.Player.Position.X < Fixed.FromInt(720), "밀린 틱을 진행하다 벽을 통과했습니다");
        Check(walker.Player.Position.X > Fixed.FromInt(700), "벽까지 이동하지 않았습니다");
    }
}
