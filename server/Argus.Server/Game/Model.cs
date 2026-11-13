namespace Argus.Server.Game;

public sealed class Player
{
    public string Id { get; }
    public string Name { get; set; }
    public string[] Slots { get; set; } = new string[] { "strike", "parry", "grab", "strike" };
    public FixedVector Position;
    // 조준 방향이다. 클라이언트가 보낸 라디안을 정수 각도로 바꿔 둔다.
    // 방향 벡터(AimDirection)는 판정마다 쓰므로 조준을 바꿀 때 한 번만 구해 둔다. 상태 요약에는 각도만 적는다.
    public Angle Aim
    {
        get
        {
            return _aim;
        }
        set
        {
            _aim = value;
            AimDirection = value.Direction();
        }
    }
    public FixedVector AimDirection { get; private set; } = Angle.Zero.Direction();
    private Angle _aim;
    public string State { get; set; } = "waiting";
    public bool HasDeployed;
    // 투입이 끝나는 틱이다.
    public long DeployTick;
    public FixedVector Landing;
    public double Hp;
    public double MaxHp;
    public int Mana;
    public int MaxMana;
    // 눌렀지만 아직 기술을 시작하지 못한 누름이다. 누른 차례대로다. 기술은 누름으로만 시작하고, 틱마다 맨 앞의 누름부터 본다.
    // 입력이 알린 "지금 누르고 있는 슬롯들"(held)은 따로 들고 있지 않는다. 도착할 때 한 번 쓰고 버린다(Match.ApplyButtons).
    // 두 틱 사이에 떼었다 다시 누르면 지금의 모습은 그대로이므로, 뗀 것은 도착할 때 기술(PlayerAction.Released)과
    // 기다리는 누름(WaitingPress.Held)에 적어 두고 진행은 그 둘만 읽는다.
    // 누름은 입력이 도착할 때 여기에 넣는다(Match.Input). 한 자리에 적으면 거의 함께 누른 두 버튼 가운데 앞의 것이 덮인다.
    // 슬롯마다 많아야 하나라 넷을 넘지 않는다.
    public List<WaitingPress> Waiting { get; } = new List<WaitingPress>();
    public List<PlayerAction> Actions { get; } = new List<PlayerAction>();
    // 입력을 마지막으로 받은 틱이다. 받은 적이 없으면 NoInputTick이다.
    public long LastInputTick = NoInputTick;
    public long LastSequence = -1;
    // 이동 방향이다. 길이는 1 이하이고, 틱마다 이 방향으로 이동 속도만큼 움직인다.
    public FixedVector Move;
    // 이 대원의 시야로 마지막에 본 칸을 넓힌 자리와 틱이다(Match.Explore). 그 자리를 벗어나면 다시 둘러볼지 정하는 데 쓴다.
    public FixedVector ExploreOrigin;
    public bool HasExploreOrigin;
    public long ExploreTick;
    public long Connection;
    public bool Connected;
    // 연결이 끊긴 틱이다. 연결되어 있으면 null이다.
    public long? DisconnectedTick;
    // HTTP로 참가했지만 아직 WebSocket으로 한 번도 접속하지 않은 자리다.
    public bool AwaitingFirstConnection;
    public int Kills;
    public int Deaths;
    // 입력을 받은 적이 없다는 표시다. 입력이 끊겼는지 볼 때 언제나 오래전으로 보이도록 충분히 이른 틱으로 둔다.
    // long.MinValue로 두면 지금 틱에서 뺄 때 넘쳐서 음수가 된다.
    public const long NoInputTick = -1_000_000;

    public Player(string id, string name)
    {
        Id = id;
        Name = name;
    }
}

// 눌렀지만 아직 기술을 시작하지 못한 누름 하나다.
public sealed class WaitingPress
{
    public int Slot { get; }
    // 그 버튼을 아직 누르고 있는지다. 뗀 것을 한 번 보면 다시 켜지 않는다. 다시 누른 것은 새 누름이다.
    public bool Held;
    // 방금 들어온 누름인지다. 들어온 뒤 첫 틱이 지나면 끈다. 방금 들어온 누름은 이미 뗐더라도 다음 틱까지 남는다.
    public bool Fresh = true;

    public WaitingPress(int slot, bool held)
    {
        Slot = slot;
        Held = held;
    }
}

// 대원이 쓴 기술 하나다. 기운이 도는 동안 → 장판이 깔린 동안 → 회복 순서로 진행한다.
// 버튼을 누르고 있으면 기운이 이어져 뒤의 단계가 그만큼 밀린다.
public sealed class PlayerAction
{
    public int Id { get; }
    public SkillDefinition Skill { get; }
    public int Slot { get; }
    public long StartedTick { get; }
    // 버튼을 누르고 있어 기운이 가장 짧은 시간보다 더 이어진 틱 수다. 장판이 나간 뒤에는 늘지 않는다.
    public long HeldTicks { get; private set; }
    // 이 기술의 버튼을 놓았는지다. 놓으면 기운을 더 잇지 않아, 가장 짧은 기운 시간이 지난 틱에 장판이 나간다.
    // 버튼을 뗐거나, 다른 버튼(또는 같은 버튼)을 새로 눌렀거나, 입력이 끊겼을 때 켠다. 한 번 켜면 끄지 않는다.
    // 뗀 뒤 다시 눌러도 이 시전의 기운은 이어지지 않는다. 다시 누른 것은 새 누름이다.
    // 입력이 도착할 때 적는다(Match.Input). 장판이 나갈 틱에만 버튼을 보면, 그 전에 지나간 뗌과 다른 버튼의 누름을 놓친다.
    public bool Released;
    public int? Target;
    // 잡기처럼 한 명만 판정하는 기술의 대상이 정해졌는지 나타낸다. 정해진 뒤에는 같은 시전에서 바꾸지 않는다.
    public bool TargetLocked;
    // 이 기술이 판정한 적이다. 한 기술은 같은 적과 한 번만 판정한다.
    public HashSet<int> JudgedEnemies { get; } = new HashSet<int>();
    // 상성 없는 장판(받아치기의 반격)이 친 적이다. 반격은 기운의 판정과 별개의 일반 타격이라 따로 적는다.
    public HashSet<int> PlainHits { get; } = new HashSet<int>();
    public HashSet<int> HitFacilities { get; } = new HashSet<int>();
    public HashSet<int> HitWalls { get; } = new HashSet<int>();
    // 기술의 시간은 모두 시작부터 잰 초를 한 번에 올림한 틱 수다. 단계마다 따로 올림하면 끝이 한 틱씩 밀릴 수 있다.
    private readonly long _auraTicks;
    private readonly long _zoneEndTicks;
    private readonly long _durationTicks;
    private readonly long _holdTicks;

    // maxAuraTicks는 버튼을 누르고 있을 때 기운이 이어지는 가장 긴 틱 수다(Rules.MaxAuraSeconds).
    public PlayerAction(int id, SkillDefinition skill, int slot, long startTick, long maxAuraTicks)
    {
        Id = id;
        Skill = skill;
        Slot = slot;
        StartedTick = startTick;
        _auraTicks = Rules.ToTicks(skill.AuraSeconds);
        _zoneEndTicks = Rules.ToTicks(skill.AuraSeconds + skill.ZoneSeconds);
        _durationTicks = Rules.ToTicks(skill.Duration);
        // 가장 짧은 기운 시간이 최대 기운 시간보다 긴 기술은 누르고 있어도 더 이어지지 않는다.
        _holdTicks = Math.Max(_auraTicks, maxAuraTicks);
    }

    // 버튼을 계속 누르고 있을 때 장판이 나가는 틱이다. 장판은 이 틱보다 늦게 나가지 않는다.
    public long HoldUntilTick
    {
        get
        {
            return StartedTick + _holdTicks;
        }
    }

    // 장판이 나가는 틱이다. 이 틱부터 몸의 기운은 없다. 버튼을 누르고 있으면 한 틱씩 뒤로 밀린다.
    public long ZoneTick
    {
        get
        {
            return StartedTick + _auraTicks + HeldTicks;
        }
    }

    // 장판이 걷히는 틱이다.
    public long ZoneUntilTick
    {
        get
        {
            return StartedTick + _zoneEndTicks + HeldTicks;
        }
    }

    // 기술이 끝나 다음 기술을 쓸 수 있는 틱이다.
    public long EndsTick
    {
        get
        {
            return StartedTick + _durationTicks + HeldTicks;
        }
    }

    // 몸에 기운이 도는지다. 기술을 시작한 틱부터 장판이 나가기 전까지다.
    // 완벽 대응을 냈거나 끊긴 기술은 그 틱의 판정이 끝날 때 대원의 기술 목록에서 빠지므로(Match.ApplyCombatResults),
    // 목록에 있는 기술은 모두 진행 중인 기술이다. 끝났다는 표시를 따로 두지 않는다.
    public bool HasAura(long tick)
    {
        return tick >= StartedTick && tick < ZoneTick;
    }

    // 장판이 나가 깔려 있는지다. 장판이 나가면 기운은 사라진다.
    public bool ZoneOut(long tick)
    {
        return tick >= ZoneTick && tick < ZoneUntilTick;
    }

    // 버튼을 누르고 있어, 장판이 나갈 틱이 되면 한 틱 미뤄질 기술인지다. 버튼을 놓았거나 최대 기운 시간에 닿았으면 아니다.
    // 누르고 있는지의 판단은 이 한 곳에 둔다. 판정(Match.HoldAuras)과 스냅샷의 held가 함께 본다.
    public bool Holding
    {
        get
        {
            return !Released && ZoneTick < HoldUntilTick;
        }
    }

    // 버튼을 누르고 있어 기운을 한 틱 더 잇는다. 장판이 나갈 틱에만 부른다.
    public void Hold()
    {
        HeldTicks++;
    }
}

// 적의 행동 하나다. 예고(기운이 돌고 장판 자리가 보인다) → 공격 창(장판이 나가고 기운은 없다) → 회복 순서로 진행한다.
public sealed class EnemyAction
{
    public int Id { get; }
    public EnemySkill Skill { get; }
    // 행동의 방향이다. 예고하는 동안 목표 대원 쪽으로 돌 수 있고(Match.TurnToTarget), 공격 창부터는 바뀌지 않는다.
    public Angle Aim { get; private set; }
    // 판정마다 쓰므로 방향이 바뀔 때만 방향 벡터를 구해 둔다.
    public FixedVector Direction { get; private set; }
    // 행동을 시작할 때 노린 대원의 id다. 예고하는 동안 이 대원 쪽으로 돈다. 없으면(검사가 직접 만든 행동) 돌지 않는다.
    public string? TargetId { get; }
    public long StartedTick { get; }
    // 공격 창이 열려 장판이 나가는 틱이다.
    public long ContactTick { get; }
    // 공격 창이 닫혀 장판이 걷히는 틱이다.
    public long ActiveUntilTick { get; }
    public long EndsTick { get; }
    // 이 행동과 이미 피해를 주고받은 대원이다. 같은 장판이 같은 대원에게 다시 닿지 않는다.
    public HashSet<string> HitPlayers { get; } = new HashSet<string>();

    // 예고 → 0.25초 공격 창 → 0.65초 회복 순서로 진행한다.
    public const double ActiveSeconds = 0.25;
    public const double RecoverySeconds = 0.65;

    public EnemyAction(int id, EnemySkill skill, Angle aim, long startTick, double windupMultiplier = 1, string? targetId = null)
    {
        Id = id;
        Skill = skill;
        // 방향과 방향 벡터는 Turn 한 곳에서 함께 정한다.
        Turn(aim);
        TargetId = targetId;
        // 판정과 클라이언트의 예고가 같은 시간을 사용하도록 실제 접촉 시각에 배율을 적용한다.
        double windup = skill.Windup * windupMultiplier;
        // 단계마다 올림하면 끝이 한 틱씩 밀릴 수 있으므로, 각 단계의 끝을 시작부터 잰 초로 한 번에 올림한다.
        StartedTick = startTick;
        ContactTick = startTick + Rules.ToTicks(windup);
        ActiveUntilTick = startTick + Rules.ToTicks(windup + ActiveSeconds);
        EndsTick = startTick + Rules.ToTicks(windup + ActiveSeconds + RecoverySeconds);
    }

    // 방향을 바꾼다. 방향 벡터도 함께 바꾼다.
    public void Turn(Angle aim)
    {
        Aim = aim;
        Direction = aim.Direction();
    }

    // 몸에 기운이 도는지다. 예고하는 동안 돌고, 공격 창이 열려 장판이 나가면 사라진다.
    public bool HasAura(long tick)
    {
        return tick >= StartedTick && tick < ContactTick;
    }

    // 장판이 나가 깔려 있는지다. 공격 창 동안이다.
    public bool ZoneOut(long tick)
    {
        return tick >= ContactTick && tick < ActiveUntilTick;
    }

    // 장판이 대원의 기운과 판정하는 동안인지다. 적의 장판은 예고할 때부터 판정하므로 예고와 공격 창을 합친 동안이다.
    public bool ZoneJudged(long tick)
    {
        return tick >= StartedTick && tick < ActiveUntilTick;
    }
}

public sealed class Enemy
{
    public int Id { get; }
    public FixedVector Position;
    public EnemyDefinition Definition { get; }
    public double Hp;
    // 다음 행동을 고를 수 있는 틱이다.
    public long NextActionTick;
    public EnemyAction? Action;

    public Enemy(int id, FixedVector position, EnemyDefinition definition)
    {
        Id = id;
        Position = position;
        Definition = definition;
        Hp = definition.Health;
    }
}

public sealed class Facility
{
    public int Id { get; }
    public FixedVector Position { get; }
    public double Hp = 4;
    public double MaxHp = 4;

    public Facility(int id, FixedVector position)
    {
        Id = id;
        Position = position;
    }
}

public sealed class Supply
{
    public int Id { get; }
    public FixedVector Position { get; }
    public SupplyKind Kind { get; }
    // 부목표 상자를 분대가 회수했는지다.
    public bool Collected;
    // 남은 횟수다. 0이면 다 쓴 상자다. 부목표 상자는 1에서 시작해 회수하면 0이 된다.
    public int UsesLeft;
    // 대원마다 이 보급을 다시 쓸 수 있게 되는 틱이다.
    public Dictionary<string, long> ReadyTicks { get; } = new Dictionary<string, long>();

    public Supply(int id, FixedVector position, SupplyKind kind, int uses)
    {
        Id = id;
        Position = position;
        Kind = kind;
        UsesLeft = uses;
    }

    public bool Objective
    {
        get
        {
            return Kind == SupplyKind.Objective;
        }
    }

    public long ReadyTick(Player player)
    {
        if (ReadyTicks.TryGetValue(player.Id, out long ready))
        {
            return ready;
        }
        return 0;
    }
}

public sealed class Effect
{
    public int Id { get; }
    public FixedVector Position { get; }
    public string Kind { get; }
    // 이 틱이 되면 지운다. 스냅샷에는 초로 바꿔 보낸다.
    public long UntilTick { get; }

    public Effect(int id, FixedVector position, string kind, long untilTick)
    {
        Id = id;
        Position = position;
        Kind = kind;
        UntilTick = untilTick;
    }
}

public sealed class Notice
{
    // 안내마다 1부터 늘어나는 순번이다. 같은 틱에 같은 문구가 두 번 나와도 클라이언트가 둘을 구분한다.
    // 안내는 공개된 사건에만 나오므로 순번이 숨은 정보를 드러내지 않는다.
    public int Id { get; }
    // 안내가 나온 틱이다. 스냅샷에는 초(at)로 바꿔 보낸다.
    public long AtTick { get; }
    public string Text { get; }

    public Notice(int id, long atTick, string text)
    {
        Id = id;
        AtTick = atTick;
        Text = text;
    }
}
