namespace Argus.Server.Game;

// 플레이 시험을 위한 초기 수치다. 확정한 판정 규칙은 docs/combat.md에 기록한다.
public sealed class Rules
{
    // 게임은 1초에 30틱, 한 틱에 정확히 Step초씩 진행한다.
    public const int TicksPerSecond = 30;
    public const double Step = 1.0 / TicksPerSecond;

    // 초로 정한 기간을 틱 수로 바꾼다. 그 시간이 다 지나는 첫 틱까지 세므로 올림한다. 0.18초는 6틱이다.
    // 실수 곱셈의 오차로 정수여야 할 값이 150.00000000000003처럼 나와 한 틱 늘지 않도록 아주 작은 여유를 뺀다.
    // 시각은 모두 틱 번호로 저장하고 비교한다. 초로 저장한 마감을 비교하면 같은 5초가 시작 틱에 따라 150틱도 되고 151틱도 된다.
    public static long ToTicks(double seconds)
    {
        return (long)Math.Ceiling(seconds * TicksPerSecond - 0.000001);
    }

    // 틱 수를 초로 바꾼다. 스냅샷처럼 초로 보여 줄 때만 쓴다.
    public static double ToSeconds(long ticks)
    {
        return (double)ticks / TicksPerSecond;
    }
    public const int MaxPlayers = 4;

    // 운영 방(생성 작전)의 규칙이다. 엘리트가 나오고 적의 준비 동작은 기본 길이(1배)다.
    // 한 대원에게는 적이 둘까지만 덤비고, 같은 대원에게 닿는 공격 사이는 1초 넘게 띄운다(공격 토큰).
    // 기본 규칙(new Rules())은 손으로 만든 맵의 검사가 쓰는 튜토리얼 수준(병사만, 준비 동작 두 배)이고 공격 토큰이 없다.
    public static Rules ForGeneratedMission()
    {
        return new Rules { AllowEliteEnemies = true, EnemyWindupMultiplier = 1, AttackersPerPlayer = 2, AttackSpacing = 1 };
    }
    // 대원 몸의 반지름이다. 판정에 쓰는 고정소수점 값이고, 스냅샷의 규칙에는 실수로 바꿔 보낸다.
    public static readonly Fixed PlayerRadius = Fixed.FromInt(13);
    public double DeploySeconds { get; init; } = 5;
    public double ExtractionSeconds { get; init; } = 20;
    public double ReconnectSeconds { get; init; } = 120;
    // HTTP 참가 후 첫 접속까지 기다리는 시간이다. 연결이 끊긴 대원의 복구 유예와 별개다.
    public double FirstConnectSeconds { get; init; } = 15;
    public double SpawnInterval { get; init; } = 7;
    public int MaxEnemies { get; init; } = 60;
    // 첫 작전에서는 기본 상성을 익히도록 일반 적만 내보내고 준비 시간을 늘린다.
    public bool AllowEliteEnemies { get; init; } = false;
    public double EnemyWindupMultiplier { get; init; } = 2;
    // 공격 토큰: 한 대원에게 동시에 덤비는 적의 수다. 그 대원을 노려 행동 중인 적과, 다가가 행동할 차례를 받은 적을 함께 센다.
    // 0이면 제한하지 않는다. 대원은 기술을 한 번에 하나만 쓰므로, 종류가 다른 예고가 한꺼번에 오면 완벽하게 해도 맞는다.
    public int AttackersPerPlayer { get; init; } = 0;
    // 같은 대원에게 닿는 두 적 행동 사이의 최소 간격(초)이다. 0이면 띄우지 않는다.
    // 가장 긴 기본기인 받아치기(0.98초)보다 길면, 앞 공격을 어떤 기술로 받아도 다음 공격이 닿기 전에 손이 풀린다.
    public double AttackSpacing { get; init; } = 0;
    // 공격 토큰을 켰을 때, 차례를 받지 못한 적은 노리는 대원에게서 이 거리(몸 중심 사이) 안으로 더 다가가지 않고 기다린다.
    // 가장 긴 적 공격이 닿는 거리(사거리 82 + 대원 반지름 13 = 95)와 대원 타격이 닿는 거리(54 + 가장 큰 적 반지름 23 = 77)보다 멀다.
    public double WaitDistance { get; init; } = 130;
    // 진 대응이나 부분 대응으로 기술이 끊긴 뒤 다음 기술을 쓸 수 있을 때까지의 시간(초)이다. 원래 끝날 때까지 묶어 두면,
    // 실수 하나에 둘러싼 다른 적의 공격이 모두 그대로 들어온다. 기술이 원래 이보다 먼저 끝나면 원래대로 끝난다.
    public double InterruptStagger { get; init; } = 0.3;
    public double PlayerSpeed { get; init; } = 180;
    public double PlayerHealth { get; init; } = 6;
    public int MaxMana { get; init; } = 24;
    public double Vision { get; init; } = 410;
    public double SupplyCooldown { get; init; } = 18;
    // 캠프 상자로 채울 수 있는 횟수다. 분대가 함께 쓰고 한 번에 쓴 사람만 채운다. 대원마다 세지 않는 것은, 새 게스트로 다시
    // 들어온 사람을 서버가 같은 사람으로 알아볼 수 없어 다시 채울 수 있기 때문이다. 횟수가 없으면 캠프 옆에서 버텨 작전이 끝나지 않는다.
    public int CampSupplyUses { get; init; } = 4;
    // 들판의 일반 보급 상자 하나로 채울 수 있는 횟수다. 캠프 상자처럼 분대가 함께 쓰고, 한 번에 쓴 사람만 채운다.
    public int FieldSupplyUses { get; init; } = 2;
    // 시설을 부순 자리에 생기는 보급 상자의 횟수다. 들판 상자처럼 쓴 사람만 채운다.
    public int FacilitySupplyUses { get; init; } = 2;
    public double GuardHalfAngle { get; init; } = Math.PI / 3;

    // 근접 타격: 범위에 닿은 적을 한 번씩 치고 시설과 벽을 부순다.
    public SkillDefinition Strike { get; } =
        new SkillDefinition("strike", "strike", 1, 0.18, 0.42, 0.66, 54, 10,
            guardsFront: false, hasFollowup: false, singleTarget: false, breaksStructures: true,
            followupBreaksStructures: false);
    // 받아치기: 전방 방어 뒤 일반 반격. 반격은 시설과 벽도 부순다.
    public SkillDefinition Parry { get; } =
        new SkillDefinition("parry", "block", 1, 0, 0.55, 0.98, 54, 10,
            guardsFront: true, hasFollowup: true, singleTarget: false, breaksStructures: false,
            followupBreaksStructures: true);
    // 잡기: 가장 가까운 한 명을 붙잡고 동작 내내 그 대상만 판정한다.
    public SkillDefinition Grab { get; } =
        new SkillDefinition("grab", "channel", 1, 0.12, 0.65, 0.85, 48, 8,
            guardsFront: false, hasFollowup: false, singleTarget: true, breaksStructures: false,
            followupBreaksStructures: false);
    public double ParryFollowupSeconds { get; init; } = 0.18;

    public SkillDefinition Skill(string id)
    {
        if (id == "strike")
        {
            return Strike;
        }
        if (id == "parry")
        {
            return Parry;
        }
        if (id == "grab")
        {
            return Grab;
        }
        throw new ArgumentOutOfRangeException(nameof(id));
    }

    public static bool ValidSlots(string[]? slots)
    {
        if (slots == null || slots.Length != 4)
        {
            return false;
        }
        if (slots[0] != "strike" || slots[1] != "parry" || slots[2] != "grab")
        {
            return false;
        }
        return slots[3] == "strike" || slots[3] == "parry" || slots[3] == "grab";
    }
}
