using System.Globalization;
using System.Text;
using Argus.Server.Game;
using static TestTools;

// 클라이언트 예측(client/src/fixed.ts, movement.ts)이 서버와 같은 계산을 하는지 대조할 자료를 만든다.
// 서버가 지금 계산한 값을 client/tests/fixed-vectors.json에 적어 두고, 브라우저 검사(client/tests/fixed.spec.ts)가 같은 값을 얻는지 본다.
// 이동 시나리오는 실제 Match에 입력을 넣고 한 틱씩 진행해 얻은 위치라, 클라이언트가 서버의 진행 순서까지 따라 하는지 확인한다.
// 서버 계산이 바뀌면 이 검사가 실패한다. 의도한 변경이면 `dotnet run --project tests/Argus.Server.Tests -- vectors`로 다시 만든다.
internal static class ClientParityTests
{
    private const string Regenerate = "dotnet run --project tests/Argus.Server.Tests -- vectors";
    // 2^26 - 1이다. 성분이 이보다 작으면 성분끼리 곱해도, 두 제곱을 더해도 2^53 - 1을 넘지 않는다.
    private const long VectorLimit = (1L << 26) - 1;

    public static void Register(List<TestCase> tests)
    {
        tests.Add(new TestCase("The client parity vectors hold exactly what the server computes now", VectorsMatch));
        tests.Add(new TestCase("The scenario blocked by bodies depends on the warden's radius, so the vectors check a collision with the larger body", BodyScenarioUsesRadius));
    }

    private static void VectorsMatch()
    {
        string path = FindPath();
        // 저장소는 줄바꿈을 LF로 두지만(.gitattributes), 다른 설정으로 받았어도 내용이 같으면 통과한다.
        string saved = File.ReadAllText(path).Replace("\r\n", "\n");
        string current = Build();
        Check(saved == current, $"{path}가 서버가 지금 계산한 값과 다릅니다. 의도한 변경이면 `{Regenerate}`로 다시 만드세요");
    }

    // 대조 자료 파일을 지금 계산한 값으로 다시 쓴다.
    public static int Write()
    {
        string path = FindPath();
        File.WriteAllText(path, Build());
        Console.WriteLine($"{path}에 대조 자료를 썼습니다");
        return 0;
    }

    // 저장소의 client/tests 폴더를 현재 폴더에서 위로 올라가며 찾는다. 못 찾으면 실행 파일이 있는 폴더에서 다시 찾는다.
    private static string FindPath()
    {
        string? found = FindFrom(Directory.GetCurrentDirectory());
        if (found == null)
        {
            found = FindFrom(AppContext.BaseDirectory);
        }
        if (found == null)
        {
            throw new InvalidOperationException("저장소의 client/tests 폴더를 찾지 못했습니다. 저장소 안에서 검사를 돌리세요");
        }
        return found;
    }

    private static string? FindFrom(string start)
    {
        DirectoryInfo? folder = new DirectoryInfo(start);
        while (folder != null)
        {
            string tests = Path.Combine(folder.FullName, "client", "tests");
            if (Directory.Exists(tests))
            {
                return Path.Combine(tests, "fixed-vectors.json");
            }
            folder = folder.Parent;
        }
        return null;
    }

    public static string Build()
    {
        StringBuilder text = new StringBuilder();
        text.Append("{\n");
        text.Append("  \"note\": \"서버(C#)가 계산한 값이다. 손으로 고치지 말고 ").Append(Regenerate).Append("로 다시 만든다.\",\n");
        // 클라이언트가 같은 값을 써야 하는 상수다. 틱 빈도와, 새 입력 없이 마지막 입력을 쓰는 최대 틱 수(받은 틱 포함)다.
        text.Append("  \"ticksPerSecond\": ").Append(Number(Rules.TicksPerSecond)).Append(",\n");
        text.Append("  \"inputHoldTicks\": ").Append(Number(Match.InputTimeoutTicks - 1)).Append(",\n");
        AppendRows(text, "multiply", MultiplyRows());
        AppendRows(text, "divide", DivideRows());
        AppendRows(text, "divideInt", DivideIntRows());
        AppendRows(text, "floorDivide", FloorDivideRows());
        AppendRows(text, "ceilingDivide", CeilingDivideRows());
        AppendRows(text, "sqrt", SqrtRows());
        AppendRows(text, "fromDouble", FromDoubleRows());
        AppendRows(text, "vectors", VectorRows());
        AppendRows(text, "throws", ThrowRows());
        AppendRows(text, "angles", AngleRows());
        AppendRows(text, "ticks", TickRows());
        AppendMap(text);
        AppendDeploy(text);
        AppendScenarios(text);
        AppendSkills(text);
        AppendPilots(text);
        text.Append("}\n");
        return text.ToString();
    }

    // 경계 근처의 Raw 값이다. 딱 절반(2048), 1 근처(4096), 대원·적의 이동 거리와 반지름, 맵 크기 근처를 고른다.
    private static readonly long[] Edges = new long[]
    {
        0, 1, -1, 2, -2, 3, -3, 2047, 2048, 2049, -2047, -2048, -2049, 4095, 4096, 4097, -4096, 6144, -6144,
        10240, 24576, 27307, 53248, -53248, 1 << 20, -(1 << 20) + 7, 8191999, -8191999, VectorLimit, -VectorLimit
    };

    private static List<string> MultiplyRows()
    {
        List<string> rows = new List<string>();
        for (int i = 0; i < Edges.Length; i++)
        {
            for (int j = i; j < Edges.Length; j++)
            {
                rows.Add(Multiply(Edges[i], Edges[j]));
            }
        }
        NumberSequence numbers = new NumberSequence(11);
        for (int i = 0; i < 120; i++)
        {
            long a = numbers.Between(VectorLimit);
            long b = numbers.Between(VectorLimit);
            rows.Add(Multiply(a, b));
        }
        return rows;
    }

    private static string Multiply(long a, long b)
    {
        Fixed product = Fixed.FromRaw(a) * Fixed.FromRaw(b);
        return Row(a, b, product.Raw);
    }

    private static List<string> DivideRows()
    {
        List<string> rows = new List<string>();
        // 딱 절반이 되는 몫(1 / 2, 3 / 2)과 음수, 1보다 작은 나누는 수를 넣는다.
        long[,] pairs = new long[,]
        {
            { 4096, 3 }, { -4096, 3 }, { 1, 2 }, { -1, 2 }, { 3, 2 }, { -3, 2 }, { 1, 8192 }, { 3, 8192 }, { -3, 8192 },
            { 6144, 4096 }, { 2896, 4096 }, { 2896, 4095 }, { 17376, 24576 }, { -17376, 24576 }, { 8191999, 1 }, { 1, 8191999 }
        };
        for (int i = 0; i < pairs.GetLength(0); i++)
        {
            rows.Add(Divide(pairs[i, 0], pairs[i, 1]));
        }
        NumberSequence numbers = new NumberSequence(12);
        for (int i = 0; i < 120; i++)
        {
            // 나뉘는 수에 4096을 곱해도 2^53을 넘지 않게 2^40 안에서 고른다.
            long a = numbers.Between(1L << 40);
            long b = numbers.Between(1L << 30);
            if (b == 0)
            {
                b = 1;
            }
            rows.Add(Divide(a, b));
        }
        return rows;
    }

    private static string Divide(long a, long b)
    {
        Fixed quotient = Fixed.FromRaw(a) / Fixed.FromRaw(b);
        return Row(a, b, quotient.Raw);
    }

    private static List<string> DivideIntRows()
    {
        List<string> rows = new List<string>();
        int[] divisors = new int[] { 1, 2, 3, 4, 5, 7, 30, -3, -30, 1000003 };
        // 30으로 나눌 때 딱 절반이 되는 15·45와 초당 200의 Raw(819200)를 넣는다.
        long[] values = new long[] { 1, -1, 2, -2, 3, -3, 15, -15, 45, -45, 737280, 819200, -819200, 1L << 50 };
        for (int i = 0; i < values.Length; i++)
        {
            for (int j = 0; j < divisors.Length; j++)
            {
                rows.Add(DivideInt(values[i], divisors[j]));
            }
        }
        NumberSequence numbers = new NumberSequence(13);
        for (int i = 0; i < 60; i++)
        {
            long a = numbers.Between(1L << 50);
            int b = divisors[i % divisors.Length];
            rows.Add(DivideInt(a, b));
        }
        return rows;
    }

    private static string DivideInt(long a, int b)
    {
        Fixed quotient = Fixed.FromRaw(a) / b;
        return Row(a, b, quotient.Raw);
    }

    private static List<long> DivisionValues(int seed)
    {
        List<long> values = new List<long>();
        int[] divisors = new int[] { 1, 4, 48 };
        // 나누어떨어지는 값과 그 앞뒤 Raw 하나를 양쪽 부호로 넣는다.
        for (int i = 0; i < divisors.Length; i++)
        {
            long whole = divisors[i] * Fixed.Scale;
            for (long k = -3; k <= 3; k++)
            {
                values.Add(k * whole - 1);
                values.Add(k * whole);
                values.Add(k * whole + 1);
            }
        }
        NumberSequence numbers = new NumberSequence((ulong)seed);
        for (int i = 0; i < 40; i++)
        {
            values.Add(numbers.Between(1L << 40));
        }
        return values;
    }

    private static List<string> FloorDivideRows()
    {
        List<string> rows = new List<string>();
        List<long> values = DivisionValues(14);
        int[] divisors = new int[] { 1, 4, 48 };
        for (int i = 0; i < values.Count; i++)
        {
            for (int j = 0; j < divisors.Length; j++)
            {
                int floored = Fixed.FromRaw(values[i]).FloorDivide(divisors[j]);
                rows.Add(Row(values[i], divisors[j], floored));
            }
        }
        return rows;
    }

    private static List<string> CeilingDivideRows()
    {
        List<string> rows = new List<string>();
        List<long> values = DivisionValues(15);
        int[] divisors = new int[] { 1, 4, 48 };
        for (int i = 0; i < values.Count; i++)
        {
            for (int j = 0; j < divisors.Length; j++)
            {
                int ceiled = Fixed.FromRaw(values[i]).CeilingDivide(divisors[j]);
                rows.Add(Row(values[i], divisors[j], ceiled));
            }
        }
        return rows;
    }

    private static List<string> SqrtRows()
    {
        List<string> rows = new List<string>();
        List<long> values = new List<long>();
        for (long value = 0; value <= 30; value++)
        {
            values.Add(value);
        }
        // 제곱수와 그 앞뒤, (r + 0.5)² 근처, 2^53 바로 아래를 넣는다.
        long[] roots = new long[] { 1000, 4096, 94906265 };
        for (int i = 0; i < roots.Length; i++)
        {
            long square = roots[i] * roots[i];
            values.Add(square - 1);
            values.Add(square);
            values.Add(square + 1);
            values.Add(square + roots[i]);
            values.Add(square + roots[i] + 1);
        }
        values.Add(Fixed.SafeLimit);
        NumberSequence numbers = new NumberSequence(16);
        for (int i = 0; i < 60; i++)
        {
            long value = (long)(numbers.Next() % (ulong)Fixed.SafeLimit);
            values.Add(value);
        }
        for (int i = 0; i < values.Count; i++)
        {
            rows.Add(Row(values[i], Fixed.RoundedSqrt(values[i])));
        }
        return rows;
    }

    private static List<string> FromDoubleRows()
    {
        List<double> values = new List<double>();
        // Raw의 딱 절반(1/8192의 홀수 배)은 0에서 먼 쪽으로 간다. 0.49999999999999994/4096은 절반보다 아주 조금 작다.
        double[] fixedValues = new double[]
        {
            0, 1.0 / 8192, -1.0 / 8192, 3.0 / 8192, -3.0 / 8192, 5.0 / 8192, -5.0 / 8192, 0.49999999999999994 / 4096,
            -0.49999999999999994 / 4096, 1 / Math.Sqrt(2), -1 / Math.Sqrt(2), 0.6, 0.8, -0.3, 0.4, 1.01, -1.01, 0.01,
            13, 180, 200, 300, 123.456, -123.456, 466, 1919.999, 1_000_000_000, -1_000_000_000
        };
        for (int i = 0; i < fixedValues.Length; i++)
        {
            values.Add(fixedValues[i]);
        }
        NumberSequence numbers = new NumberSequence(17);
        for (int i = 0; i < 80; i++)
        {
            // 맵 안팎의 좌표처럼 정수 부분과 소수 부분을 함께 가진 실수다.
            double whole = numbers.Between(1_000_000);
            double fraction = (double)(numbers.Next() >> 11) / (1UL << 53);
            values.Add(whole + fraction);
        }
        List<string> rows = new List<string>();
        for (int i = 0; i < values.Count; i++)
        {
            Fixed converted = Fixed.FromDouble(values[i]);
            rows.Add("[" + Number(values[i]) + ", " + Number(converted.Raw) + "]");
        }
        return rows;
    }

    private static List<string> VectorRows()
    {
        List<string> rows = new List<string>();
        long[,] fixedVectors = new long[,]
        {
            { 0, 0 }, { 1, 0 }, { 0, -1 }, { 2, 4 }, { 3, 5 }, { -79, 79 }, { 2896, 2896 }, { 2458, 3277 }, { -1229, 1638 },
            { 4096, 41 }, { 4137, 0 }, { 24576, 0 }, { VectorLimit, VectorLimit }, { -VectorLimit, 3 }
        };
        for (int i = 0; i < fixedVectors.GetLength(0); i++)
        {
            rows.Add(VectorRow(fixedVectors[i, 0], fixedVectors[i, 1]));
        }
        NumberSequence numbers = new NumberSequence(18);
        for (int i = 0; i < 80; i++)
        {
            // 짧은 벡터(입력 방향)와 긴 벡터(좌표 차이)를 반씩 고른다.
            long limit = VectorLimit;
            if (i % 2 == 0)
            {
                limit = 8192;
            }
            rows.Add(VectorRow(numbers.Between(limit), numbers.Between(limit)));
        }
        return rows;
    }

    private static string VectorRow(long x, long y)
    {
        FixedVector vector = new FixedVector(Fixed.FromRaw(x), Fixed.FromRaw(y));
        FixedVector normal = vector.Normalize();
        return Row(x, y, vector.LengthSquared().Raw, vector.Length().Raw, normal.X.Raw, normal.Y.Raw);
    }

    // 서버가 예외를 내는 계산이다. 클라이언트도 같은 계산에서 예외를 내야 한다. 적은 값이 정말 예외를 내는지도 여기서 확인한다.
    private static List<string> ThrowRows()
    {
        List<string> rows = new List<string>();
        rows.Add(ExpectThrow("multiply", 1L << 27, 1L << 27, () => Fixed.FromRaw(1L << 27) * Fixed.FromRaw(1L << 27)));
        rows.Add(ExpectThrow("divide", 1L << 42, 4096, () => Fixed.FromRaw(1L << 42) / Fixed.FromRaw(4096)));
        rows.Add(ExpectThrow("divide", 4096, 0, () => Fixed.FromRaw(4096) / Fixed.FromRaw(0)));
        rows.Add(ExpectThrow("divideInt", 4096, 0, () => Fixed.FromRaw(4096) / 0));
        rows.Add(ExpectThrow("length", 1L << 27, 0, () => new FixedVector(Fixed.FromRaw(1L << 27), Fixed.Zero).Length()));
        rows.Add(ExpectThrow("floorDivide", 4096, 0, () => Fixed.FromRaw(4096).FloorDivide(0)));
        rows.Add(ExpectThrow("ceilingDivide", 4096, -4, () => Fixed.FromRaw(4096).CeilingDivide(-4)));
        rows.Add(ExpectThrow("fromDouble", 10_000_000_000, 0, () => Fixed.FromDouble(10_000_000_000)));
        return rows;
    }

    private static string ExpectThrow(string operation, long a, long b, Func<object> calculation)
    {
        bool threw = false;
        try
        {
            calculation();
        }
        catch (OverflowException)
        {
            threw = true;
        }
        catch (ArgumentOutOfRangeException)
        {
            threw = true;
        }
        catch (DivideByZeroException)
        {
            threw = true;
        }
        Check(threw, $"{operation}({a}, {b})가 예외를 내지 않았습니다");
        return "[\"" + operation + "\", " + Number(a) + ", " + Number(b) + "]";
    }

    private static void AppendMap(StringBuilder text)
    {
        BattleMap map = new BattleMap(MissionLayout.CreateHandmade());
        text.Append("  \"map\": { \"cell\": ").Append(Number(BattleMap.Cell));
        text.Append(", \"columns\": ").Append(Number(map.Columns));
        text.Append(", \"rows\": ").Append(Number(map.Rows));
        text.Append(", \"walls\": \"").Append(Convert.ToBase64String(map.Tiles)).Append("\" },\n");
    }

    // 투입 요청의 답을 묻는 격자다. 캠프 시야의 가장자리와 본 벽 (10, 18), 안 본 벽 (10, 10)·(10, 11)·(11, 18)의 둘레를 덮는다.
    private const int DeployLeft = 360;
    private const int DeployTop = 440;
    private const int DeployStep = 5;
    private const int DeployColumns = 53;
    private const int DeployRows = 101;

    // 손으로 만든 맵의 방을 막 만든 상태(캠프 둘레만 본 칸)에서 격자의 자리마다 Match.Deploy가 받아들이는지(1) 거절하는지(0) 적는다.
    // 클라이언트는 그 방의 스냅샷 벽 배열(본 칸만 실제 값이고 나머지는 모름)로 같은 답을 내야 한다.
    private static void AppendDeploy(StringBuilder text)
    {
        Match match = new Match("PARITY", new Rules { MaxEnemies = 0 }, 73);
        Player player = match.Join("p", "pilot")!;
        StringBuilder answers = new StringBuilder();
        int unseen = 0;
        int overUnseenWall = 0;
        for (int row = 0; row < DeployRows; row++)
        {
            for (int column = 0; column < DeployColumns; column++)
            {
                FixedVector spot = FixedVector.FromInt(DeployLeft + column * DeployStep, DeployTop + row * DeployStep);
                bool accepted = match.Deploy(player, spot.X.ToDouble(), spot.Y.ToDouble());
                bool fits = match.Map.CanStand(spot, Rules.PlayerRadius);
                if (accepted)
                {
                    answers.Append('1');
                    // 받아들이면 투입 중이 되므로 다음 자리를 묻기 전에 기다림으로 되돌린다.
                    player.State = "waiting";
                }
                else
                {
                    answers.Append('0');
                }
                // 실제로는 빈 땅인데 보지 못해 거절한 자리와, 몸이 안 본 벽에 걸리는데 받아들인 자리를 센다.
                if (!accepted && fits && !match.Explored(spot))
                {
                    unseen++;
                }
                if (accepted && !fits)
                {
                    overUnseenWall++;
                }
            }
        }
        Check(unseen > 0 && overUnseenWall > 0, $"격자가 본 칸의 경계를 덮지 못합니다(보지 못한 빈 땅 {unseen}, 안 본 벽에 걸린 자리 {overUnseenWall})");
        text.Append("  \"deploy\": { \"walls\": \"").Append(Convert.ToBase64String(match.PublicTiles())).Append('"');
        text.Append(", \"radius\": ").Append(Number(Rules.PlayerRadius.Raw));
        text.Append(", \"left\": ").Append(Number(DeployLeft));
        text.Append(", \"top\": ").Append(Number(DeployTop));
        text.Append(", \"step\": ").Append(Number(DeployStep));
        text.Append(", \"columns\": ").Append(Number(DeployColumns));
        text.Append(", \"rows\": ").Append(Number(DeployRows));
        text.Append(", \"answers\": \"").Append(answers.ToString()).Append("\" },\n");
    }

    // 실제 Match에 입력을 넣고 한 틱씩 진행한 위치다. 열린 땅의 여러 방향, 벽 모서리와 벽 면, 적, 맵 가장자리,
    // 걸음 수가 다른 이동 속도(한 틱에 3·6·6.667·10)를 고른다. 대각선 입력은 클라이언트처럼 (1, 1)을 길이로 나눈 값이다.
    private static void AppendScenarios(StringBuilder text)
    {
        double diagonal = 1 / Math.Sqrt(2);
        List<string> scenarios = new List<string>();

        List<double[]?> open = new List<double[]?>();
        AddInputs(open, 8, 1, 0);
        AddInputs(open, 8, diagonal, diagonal);
        AddInputs(open, 8, 0.6, -0.8);
        AddInputs(open, 6, -0.3, 0.4);
        AddInputs(open, 6, 1, 0.01);
        AddInputs(open, 3, 0, 0);
        AddInputs(open, 8, -1, 0);
        AddInputs(open, 8, -diagonal, -diagonal);
        scenarios.Add(RunScenario("열린 땅에서 여러 방향", 180, FixedVector.FromInt(300, 730), new List<FixedVector>(), new List<EnemyDefinition>(), open));

        // 장애물 칸 (10, 10)·(10, 11)은 x 480~528, y 480~576이다. 왼쪽 위 꼭짓점을 대각선으로 스친 뒤 왼쪽 면을 따라 내려간다.
        List<double[]?> corner = new List<double[]?>();
        AddInputs(corner, 16, diagonal, diagonal);
        AddInputs(corner, 8, 0, 1);
        scenarios.Add(RunScenario("벽 모서리를 스치고 벽 면을 따라 내려감", 180, FixedVector.FromInt(440, 452), new List<FixedVector>(), new List<EnemyDefinition>(), corner));

        List<double[]?> slide = new List<double[]?>();
        AddInputs(slide, 12, 1, 0.25);
        AddInputs(slide, 8, 1, -0.25);
        scenarios.Add(RunScenario("벽 면에 비스듬히 밀며 미끄러짐", 180, FixedVector.FromInt(455, 530), new List<FixedVector>(), new List<EnemyDefinition>(), slide));

        scenarios.Add(BlockedScenario(EnemyDefinition.Warden));

        List<double[]?> uneven = new List<double[]?>();
        AddInputs(uneven, 8, 0.6, 0.8);
        AddInputs(uneven, 8, diagonal, diagonal);
        AddInputs(uneven, 8, 1, 0);
        AddInputs(uneven, 8, -0.3, 0.4);
        AddInputs(uneven, 8, 0, -1);
        scenarios.Add(RunScenario("나누어떨어지지 않는 걸음(초당 200)", 200, FixedVector.FromInt(300, 730), new List<FixedVector>(), new List<EnemyDefinition>(), uneven));

        List<double[]?> edge = new List<double[]?>();
        AddInputs(edge, 10, -1, 0.1);
        AddInputs(edge, 6, -diagonal, -diagonal);
        scenarios.Add(RunScenario("맵 가장자리 벽에 막힘", 180, FixedVector.FromInt(75, 730), new List<FixedVector>(), new List<EnemyDefinition>(), edge));

        List<double[]?> slow = new List<double[]?>();
        AddInputs(slow, 10, 0.6, 0.8);
        AddInputs(slow, 10, -diagonal, diagonal);
        scenarios.Add(RunScenario("한 걸음으로 끝나는 이동(초당 90)", 90, FixedVector.FromInt(300, 730), new List<FixedVector>(), new List<EnemyDefinition>(), slow));

        List<double[]?> fast = new List<double[]?>();
        AddInputs(fast, 10, diagonal, -diagonal);
        AddInputs(fast, 6, 1, 0);
        scenarios.Add(RunScenario("세 걸음으로 나누는 빠른 이동(초당 300)", 300, FixedVector.FromInt(420, 640), new List<FixedVector>(), new List<EnemyDefinition>(), fast));

        // 입력이 끊기면 서버는 마지막 입력을 계속 쓰다가 받은 틱부터 10틱이 지나면 멈춘다. 짧은 끊김(2틱)과 그보다 긴 끊김(14틱)이다.
        List<double[]?> gaps = new List<double[]?>();
        AddInputs(gaps, 3, 1, 0);
        AddGap(gaps, 2);
        AddInputs(gaps, 3, diagonal, diagonal);
        AddGap(gaps, 14);
        AddInputs(gaps, 3, -1, 0);
        scenarios.Add(RunScenario("입력이 끊겨도 마지막 입력을 10틱까지 씀", 180, FixedVector.FromInt(300, 730), new List<FixedVector>(), new List<EnemyDefinition>(), gaps));

        text.Append("  \"scenarios\": [\n");
        for (int i = 0; i < scenarios.Count; i++)
        {
            text.Append(scenarios[i]);
            if (i < scenarios.Count - 1)
            {
                text.Append(',');
            }
            text.Append('\n');
        }
        text.Append("  ],\n");
    }

    // 라디안을 방향으로 바꾼 값이다. 줄마다 [라디안, 칸 수, 방향 벡터의 Raw x, Raw y]다. 서 있는 대원의 대시가 조준한 쪽으로 가므로,
    // 클라이언트도 보낸 조준에서 같은 방향 벡터를 얻어야 한다. 축 방향, 사분면 경계, 한 바퀴를 넘는 값, 음수, 아주 작은 값과
    // 정해진 수열로 고른 값을 본다.
    private static List<string> AngleRows()
    {
        List<double> values = new List<double>();
        double[] edges = new double[]
        {
            0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI, Math.Tau, -Math.Tau, Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4,
            1e-9, -1e-9, 0.000047936899, 0.00009587379924285257, 1, -1, 2.5, -2.5, 7, -7, 100, -100, 12345.678, 1e6, -1e6,
            Math.Atan2(1, 2), Math.Atan2(-3, 1), Math.Atan2(0.01, -1), Math.Atan2(-0.01, -1)
        };
        for (int i = 0; i < edges.Length; i++)
        {
            values.Add(edges[i]);
        }
        // 칸의 경계(칸 수 + 0.5)에 걸리는 값과 그 양옆이다. 반올림이 갈리는 자리다.
        for (int units = 0; units < Angle.UnitsPerTurn; units += 4099)
        {
            double middle = (units + 0.5) / Angle.UnitsPerTurn * Math.Tau;
            values.Add(middle);
            values.Add(Math.BitDecrement(middle));
            values.Add(Math.BitIncrement(middle));
        }
        NumberSequence numbers = new NumberSequence(20261115);
        for (int i = 0; i < 300; i++)
        {
            values.Add(numbers.Between(8_000_000) / 1_000_000.0);
        }
        List<string> rows = new List<string>();
        for (int i = 0; i < values.Count; i++)
        {
            Angle angle = Angle.FromRadians(values[i]);
            FixedVector direction = angle.Direction();
            rows.Add("[" + Number(values[i]) + ", " + Number(angle.Units) + ", " + Number(direction.X.Raw) + ", " + Number(direction.Y.Raw) + "]");
        }
        return rows;
    }

    // 초로 정한 기간을 틱 수로 올린 값이다(Rules.ToTicks). 줄마다 [초, 틱 수]다. 클라이언트는 기술의 초를 같은 식으로 틱으로 바꾼다.
    // 30을 곱하면 정수에서 실수 오차만큼 넘치는 값과 틱의 배수, 그 사이의 값을 넣는다. 31틱을 초로 적은 값(31 / 30)은 30을 곱하면
    // 31.000000000000004이고 8.3초는 249.00000000000003이다. 아주 작은 여유를 빼지 않고 올리면 32틱과 250틱이 된다.
    private static List<string> TickRows()
    {
        List<double> values = new List<double>();
        double[] edges = new double[] { 0, 0.001, 0.0333, 0.034, 0.1, 0.12, 0.15, 0.18, 0.2, 0.24, 0.3, 0.42, 0.55, 0.66, 0.7, 0.73, 0.85, 0.95, 0.98, 1, 1.1, 1.2, 1.7, 1.9, 2.2, 2.3, 4.35, 5, 8.3, 8.9, 16.1, 16.6 };
        for (int i = 0; i < edges.Length; i++)
        {
            values.Add(edges[i]);
        }
        for (int ticks = 1; ticks <= 90; ticks++)
        {
            values.Add(ticks / 30.0);
            values.Add(ticks * (1.0 / 30));
        }
        for (int hundredths = 1; hundredths <= 300; hundredths += 7)
        {
            values.Add(hundredths / 100.0);
        }
        List<string> rows = new List<string>();
        for (int i = 0; i < values.Count; i++)
        {
            rows.Add("[" + Number(values[i]) + ", " + Number(Rules.ToTicks(values[i])) + "]");
        }
        return rows;
    }

    // 대원 기술의 정의 가운데 예측에 쓰는 값과 최대 기운 시간이다. 클라이언트는 스냅샷의 규칙에서 같은 값을 받는다.
    private static void AppendSkills(StringBuilder text)
    {
        Rules rules = new Rules();
        text.Append("  \"maxAuraSeconds\": ").Append(Number(rules.MaxAuraSeconds)).Append(",\n");
        text.Append("  \"skills\": [\n");
        for (int i = 0; i < Rules.AllSkills.Count; i++)
        {
            SkillDefinition skill = Rules.AllSkills[i];
            text.Append("    { \"id\": \"").Append(skill.Id).Append("\", \"mana\": ").Append(Number(skill.Mana));
            text.Append(", \"auraSeconds\": ").Append(Number(skill.AuraSeconds));
            text.Append(", \"duration\": ").Append(Number(skill.Duration));
            text.Append(", \"dashDistance\": ").Append(Number(skill.DashDistance));
            // 클라이언트가 초에서 구한 틱 수와 한 틱의 대시 거리가 서버와 같은지 본다.
            text.Append(", \"auraTicks\": ").Append(Number(Rules.ToTicks(skill.AuraSeconds)));
            text.Append(", \"durationTicks\": ").Append(Number(Rules.ToTicks(skill.Duration)));
            text.Append(", \"dashStep\": ").Append(Number(skill.DashStep.Raw)).Append(" }");
            if (i < Rules.AllSkills.Count - 1)
            {
                text.Append(',');
            }
            text.Append('\n');
        }
        text.Append("  ],\n");
    }

    // 버튼까지 실은 입력 하나다. 이동, 조준(라디안), 누르고 있는 슬롯, 지난 입력 뒤에 누른 슬롯이다.
    private sealed class PilotInput
    {
        public double MoveX;
        public double MoveY;
        public double Aim;
        public int[] Held = new int[0];
        public int[] Pressed = new int[0];
    }

    // 같은 입력을 count틱 동안 틱마다 보낸다. 누름(pressed)은 첫 입력에만 싣는다.
    private static void AddPilotInputs(List<PilotInput?> inputs, int count, double moveX, double moveY, double aim, int[] held, int[] pressed)
    {
        for (int i = 0; i < count; i++)
        {
            PilotInput input = new PilotInput();
            input.MoveX = moveX;
            input.MoveY = moveY;
            input.Aim = aim;
            input.Held = held;
            if (i == 0)
            {
                input.Pressed = pressed;
            }
            inputs.Add(input);
        }
    }

    private static readonly int[] None = new int[0];
    private static readonly int[] DashHeld = new int[] { 4 };
    private static readonly string[] DashSlots = new string[] { "strike", "spinblock", "grab", "dash" };

    // 기술 차례와 대시가 든 시나리오다. 내 위치를 예측하려면 누름이 어느 틱에 무슨 기술로 시작하는지도 서버와 같아야 한다.
    // 적의 행동이 없는 방이라 전투 판정으로 기술이 끝나거나 끊기는 일은 없다(그것은 클라이언트가 미리 알 수 없다).
    private static void AppendPilots(StringBuilder text)
    {
        double diagonal = 1 / Math.Sqrt(2);
        List<string> pilots = new List<string>();
        List<FixedVector> noBodies = new List<FixedVector>();
        List<EnemyDefinition> noKinds = new List<EnemyDefinition>();
        // 캠프 북쪽의 빈 땅이다. 캠프 옆의 보급 상자(370, 770)에서 멀어, 시나리오가 그 둘레 35 안을 지나지 않는다.
        // 보급 상자 옆을 지나면 마나가 차는데 클라이언트는 보급을 따라 하지 않는다(RunPilot이 확인한다).
        FixedVector field = FixedVector.FromInt(300, 400);

        // 걷다가 대시한다. 대시하는 동안에는 이동 입력을 바꿔도 방향이 그대로다.
        List<PilotInput?> walking = new List<PilotInput?>();
        AddPilotInputs(walking, 3, 1, 0, 0, None, None);
        AddPilotInputs(walking, 1, 1, 0, 0, None, DashHeld);
        AddPilotInputs(walking, 6, 0, 1, 0, None, None);
        AddPilotInputs(walking, 1, diagonal, -diagonal, 2, DashHeld, DashHeld);
        AddPilotInputs(walking, 7, -1, 0, 2, DashHeld, None);
        AddPilotInputs(walking, 1, 0.6, -0.8, 0, None, DashHeld);
        AddPilotInputs(walking, 6, 0.6, -0.8, 0, None, None);
        // 살살 걷던(이동 입력의 길이가 절반) 대원도 대시는 그 방향으로 다 간다.
        AddPilotInputs(walking, 1, 0.3, 0.4, 0, None, DashHeld);
        AddPilotInputs(walking, 6, 0.3, 0.4, 0, None, None);
        pilots.Add(RunPilot("걷다가 대시", field, noBodies, noKinds, DashSlots, 24, walking));

        // 서서 대시하면 조준한 쪽으로 간다. 조준을 여러 각도로 바꿔 가며 한 번씩 대시한다. 아주 짧은 이동 입력도 서 있는 것으로 본다.
        // 각도마다 반대쪽으로 한 번 더 대시해 출발한 자리 둘레에 머문다. 멀리 가면 보급 상자 옆을 지나 마나가 찬다
        // (클라이언트는 보급을 따라 하지 않는다).
        List<PilotInput?> standing = new List<PilotInput?>();
        double[] aims = new double[] { 0, 0.3, 1.2, Math.PI / 2, 2.5, -2.2, -0.05, 4, 100.25 };
        for (int i = 0; i < aims.Length; i++)
        {
            double tiny = 0;
            if (i % 3 == 1)
            {
                tiny = 0.0001;
            }
            AddPilotInputs(standing, 1, tiny, 0, aims[i], None, DashHeld);
            AddPilotInputs(standing, 6, tiny, 0, aims[i], None, None);
            AddPilotInputs(standing, 1, 0, tiny, aims[i] + Math.PI, None, DashHeld);
            AddPilotInputs(standing, 6, 0, tiny, aims[i] + Math.PI, None, None);
        }
        pilots.Add(RunPilot("서서 조준한 쪽으로 대시", field, noBodies, noKinds, DashSlots, 24, standing));

        // 서 있는 것으로 보는 기준의 양쪽이다. 이동 입력의 길이가 Raw 119(길이의 제곱이 Raw 3)면 서 있는 것이라 조준한 쪽으로 가고,
        // Raw 120(제곱이 Raw 4)이면 걷는 것이라 그 방향으로 간다. 아래 → 오른쪽 → 왼쪽 → 위로 한 번씩 가서 출발한 자리로 돌아온다.
        double below = 119 / 4096.0;
        double above = 120 / 4096.0;
        List<PilotInput?> faint = new List<PilotInput?>();
        AddPilotInputs(faint, 1, below, 0, Math.PI / 2, None, DashHeld);
        AddPilotInputs(faint, 6, 0, 0, Math.PI / 2, None, None);
        AddPilotInputs(faint, 1, above, 0, -Math.PI / 2, None, DashHeld);
        AddPilotInputs(faint, 6, 0, 0, -Math.PI / 2, None, None);
        AddPilotInputs(faint, 1, 0, -below, Math.PI, None, DashHeld);
        AddPilotInputs(faint, 6, 0, 0, Math.PI, None, None);
        AddPilotInputs(faint, 1, 0, -above, 0, None, DashHeld);
        AddPilotInputs(faint, 6, 0, 0, 0, None, None);
        pilots.Add(RunPilot("아주 짧은 이동 입력", field, noBodies, noKinds, DashSlots, 24, faint));

        // 벽 모서리와 벽 면에 닿는 대시다. 가로와 세로를 따로 움직여 막힌 쪽만 멈춘다.
        List<PilotInput?> walls = new List<PilotInput?>();
        AddPilotInputs(walls, 1, 1, 0.35, 0, None, DashHeld);
        AddPilotInputs(walls, 6, 1, 0.35, 0, None, None);
        AddPilotInputs(walls, 1, 0.2, -1, 0, None, DashHeld);
        AddPilotInputs(walls, 6, 0.2, -1, 0, None, None);
        AddPilotInputs(walls, 1, -1, 1, 0, None, DashHeld);
        AddPilotInputs(walls, 6, -1, 1, 0, None, None);
        pilots.Add(RunPilot("벽에 닿는 대시", FixedVector.FromInt(440, 452), noBodies, noKinds, DashSlots, 24, walls));

        // 멈춘 적의 몸에 막히는 대시다.
        List<FixedVector> bodies = new List<FixedVector>();
        List<EnemyDefinition> kinds = new List<EnemyDefinition>();
        bodies.Add(field + FixedVector.FromInt(80, 12));
        kinds.Add(EnemyDefinition.Warden);
        bodies.Add(field + FixedVector.FromInt(0, -90));
        kinds.Add(EnemyDefinition.Grunt);
        List<PilotInput?> blocked = new List<PilotInput?>();
        AddPilotInputs(blocked, 1, 1, 0, 0, None, DashHeld);
        AddPilotInputs(blocked, 6, 1, 0, 0, None, None);
        AddPilotInputs(blocked, 1, 0, 0, -Math.PI / 2, None, DashHeld);
        AddPilotInputs(blocked, 6, 0, 0, -Math.PI / 2, None, None);
        AddPilotInputs(blocked, 1, 0.3, 1, 0, None, DashHeld);
        AddPilotInputs(blocked, 6, 0.3, 1, 0, None, None);
        pilots.Add(RunPilot("적의 몸에 막히는 대시", field, bodies, kinds, DashSlots, 24, blocked));

        // 쓰던 기술이 끝날 때까지 기다린다. 근접 타격(20틱)을 짧게 누른 뒤 대시를 누르고 있으면 타격이 끝나는 틱에 나간다.
        // 대시를 짧게 눌렀다 떼면 버려진다. 그 뒤 다시 눌러 누르고 있으면 나간다.
        int[] strikeTap = new int[] { 1 };
        List<PilotInput?> queued = new List<PilotInput?>();
        AddPilotInputs(queued, 1, 1, 0, 0, None, strikeTap);
        AddPilotInputs(queued, 3, 1, 0, 0, None, None);
        AddPilotInputs(queued, 1, 1, 0, 0, None, DashHeld);
        AddPilotInputs(queued, 5, 1, 0, 0, None, None);
        AddPilotInputs(queued, 1, 0, 1, 0, DashHeld, DashHeld);
        AddPilotInputs(queued, 18, 0, 1, 0, DashHeld, None);
        AddPilotInputs(queued, 4, 0, 1, 0, None, None);
        pilots.Add(RunPilot("쓰던 기술 뒤에서 기다리는 대시", field, noBodies, noKinds, DashSlots, 24, queued));

        // 기운을 잇던 기술(회전 방어를 누르고 있음)은 대시를 누르면 놓은 것이 된다. 장판이 나가고, 기술이 끝나면 대시가 나간다.
        // 누르고 있어 길어진 만큼 끝도 밀린다.
        int[] blockHeld = new int[] { 2 };
        int[] both = new int[] { 2, 4 };
        List<PilotInput?> aura = new List<PilotInput?>();
        AddPilotInputs(aura, 1, 0, 0, 1, blockHeld, blockHeld);
        AddPilotInputs(aura, 13, 0, 0, 1, blockHeld, None);
        AddPilotInputs(aura, 1, 0, 0, 1, both, DashHeld);
        AddPilotInputs(aura, 20, 0, 0, 1, both, None);
        AddPilotInputs(aura, 3, 0, 0, 1, None, None);
        pilots.Add(RunPilot("기운을 잇던 기술 뒤의 대시", field, noBodies, noKinds, DashSlots, 24, aura));

        // 기운을 잇던 버튼을 다른 버튼을 누르지 않고 그냥 놓으면 그 틱에 장판이 나간다. 누르고 있어 길어진 만큼(네 틱) 끝도 밀려
        // 24틱 뒤에 끝나고, 그 사이에 눌러 누르고 있는 대시는 그 끝에 나간다.
        List<PilotInput?> letGo = new List<PilotInput?>();
        AddPilotInputs(letGo, 1, 1, 0, 0, blockHeld, blockHeld);
        AddPilotInputs(letGo, 9, 1, 0, 0, blockHeld, None);
        AddPilotInputs(letGo, 2, 1, 0, 0, None, None);
        AddPilotInputs(letGo, 1, 1, 0, 0, DashHeld, DashHeld);
        AddPilotInputs(letGo, 18, 1, 0, 0, DashHeld, None);
        pilots.Add(RunPilot("기운을 잇다가 놓은 뒤의 대시", field, noBodies, noKinds, DashSlots, 24, letGo));

        // 누르고만 있는 기운은 최대 기운 시간(30틱)에 장판이 나가고, 그 뒤에 누른 대시는 기술이 끝난 다음에 나간다.
        List<PilotInput?> longest = new List<PilotInput?>();
        AddPilotInputs(longest, 1, 0, 0, 0, blockHeld, blockHeld);
        AddPilotInputs(longest, 34, 0, 0, 0, blockHeld, None);
        AddPilotInputs(longest, 1, -1, 0, 0, both, DashHeld);
        AddPilotInputs(longest, 16, -1, 0, 0, both, None);
        pilots.Add(RunPilot("최대 기운 시간 뒤의 대시", field, noBodies, noKinds, DashSlots, 24, longest));

        // 한 입력에 누름이 둘이면 누른 차례대로 나간다. [대시, 타격]은 대시가 먼저 나가고, 누르고 있는 타격이 대시가 끝나는 틱에 나간다.
        // [타격, 대시]는 타격이 먼저 나가고, 누르고 있는 대시가 타격이 끝나는 틱에 나간다.
        int[] dashThenStrike = new int[] { 4, 1 };
        int[] strikeThenDash = new int[] { 1, 4 };
        int[] strikeHeld = new int[] { 1 };
        List<PilotInput?> pairs = new List<PilotInput?>();
        AddPilotInputs(pairs, 1, 0, -1, 0, strikeHeld, dashThenStrike);
        AddPilotInputs(pairs, 8, 0, -1, 0, strikeHeld, None);
        AddPilotInputs(pairs, 21, 0, -1, 0, None, None);
        AddPilotInputs(pairs, 1, 1, 0, 0, DashHeld, strikeThenDash);
        AddPilotInputs(pairs, 26, 1, 0, 0, DashHeld, None);
        AddPilotInputs(pairs, 3, 1, 0, 0, None, None);
        pilots.Add(RunPilot("한 입력에 누름 둘", field, noBodies, noKinds, DashSlots, 24, pairs));

        // 마나가 모자라면 대시가 나가지 않는다. 마나 1로 시작해 한 번 대시한 뒤의 누름은 버려진다.
        List<PilotInput?> empty = new List<PilotInput?>();
        AddPilotInputs(empty, 1, 1, 0, 0, None, DashHeld);
        AddPilotInputs(empty, 6, 1, 0, 0, None, None);
        AddPilotInputs(empty, 1, 1, 0, 0, DashHeld, DashHeld);
        AddPilotInputs(empty, 6, 1, 0, 0, DashHeld, None);
        pilots.Add(RunPilot("마나가 모자란 대시", field, noBodies, noKinds, DashSlots, 1, empty));

        // 대시하는 중에 입력이 끊겨도 대시는 이어지고, 그 뒤에는 마지막 입력으로 걷는다.
        List<PilotInput?> gaps = new List<PilotInput?>();
        AddPilotInputs(gaps, 2, 0, 1, 0, None, None);
        AddPilotInputs(gaps, 1, 0, 1, 0, None, DashHeld);
        for (int i = 0; i < 8; i++)
        {
            gaps.Add(null);
        }
        AddPilotInputs(gaps, 3, 1, 0, 0, None, None);
        pilots.Add(RunPilot("대시 중에 입력이 끊김", field, noBodies, noKinds, DashSlots, 24, gaps));

        // 대시하는 중에 다시 눌러 누르고 있으면 앞의 대시가 끝나는 틱에 다음 대시가 나간다. 방향은 그 틱에 걷던 쪽이다.
        // 둘째 대시 중에 짧게 눌렀다 뗀 것은 버려져, 대시가 끝나면 걷는다.
        List<PilotInput?> chained = new List<PilotInput?>();
        AddPilotInputs(chained, 1, 1, 0, 0, None, DashHeld);
        AddPilotInputs(chained, 1, 1, 0, 0, DashHeld, DashHeld);
        AddPilotInputs(chained, 2, 1, 0, 0, DashHeld, None);
        AddPilotInputs(chained, 4, 0, -1, 0, DashHeld, None);
        AddPilotInputs(chained, 1, 0, -1, 0, None, DashHeld);
        AddPilotInputs(chained, 6, -1, 0, 0, None, None);
        pilots.Add(RunPilot("이어지는 대시", field, noBodies, noKinds, DashSlots, 24, chained));

        // 한 입력에 누른 두 버튼을 모두 누르고 있다. 앞의 기술(회전 방어)은 뒤에 기다리는 누름이 있어 기운을 잇지 않는다.
        // 가장 짧은 기운 뒤에 장판이 나가고, 그 기술이 끝나는 틱(20틱 뒤)에 대시가 나간다.
        int[] blockThenDash = new int[] { 2, 4 };
        List<PilotInput?> together = new List<PilotInput?>();
        AddPilotInputs(together, 1, 1, 0, 0, both, blockThenDash);
        AddPilotInputs(together, 27, 1, 0, 0, both, None);
        pilots.Add(RunPilot("누르고 있는 두 버튼", field, noBodies, noKinds, DashSlots, 24, together));

        // 쓰던 기술이 끝나기 두 틱 전에 짧게 눌렀다 뗀 대시는 버려지고, 한 틱 전에 누른 것은 나간다.
        // 뗀 누름도 그다음 틱까지는 남기 때문이다(뗀 누름은 한 번만 더 본다).
        List<PilotInput?> lastTick = new List<PilotInput?>();
        AddPilotInputs(lastTick, 1, 0, 1, 0, None, strikeTap);
        AddPilotInputs(lastTick, 17, 0, 1, 0, None, None);
        AddPilotInputs(lastTick, 1, 0, 1, 0, None, DashHeld);
        AddPilotInputs(lastTick, 2, 0, 1, 0, None, None);
        AddPilotInputs(lastTick, 1, 0, 1, 0, None, strikeTap);
        AddPilotInputs(lastTick, 18, 0, 1, 0, None, None);
        AddPilotInputs(lastTick, 1, 0, 1, 0, None, DashHeld);
        AddPilotInputs(lastTick, 7, 0, 1, 0, None, None);
        pilots.Add(RunPilot("기술이 끝나기 직전에 짧게 누른 대시", field, noBodies, noKinds, DashSlots, 24, lastTick));

        // 기다리던 버튼을 쓰던 기술이 끝나기 전에 떼면 그 누름은 버려진다. 근접 타격(20틱)을 쓰는 중에 대시를 눌러 일곱 틱을 누르고
        // 있다가 뗀다. 타격이 끝나도 대시는 나가지 않고 계속 걷는다.
        List<PilotInput?> givenUp = new List<PilotInput?>();
        AddPilotInputs(givenUp, 1, -1, 0, 0, None, strikeTap);
        AddPilotInputs(givenUp, 2, -1, 0, 0, None, None);
        AddPilotInputs(givenUp, 1, -1, 0, 0, DashHeld, DashHeld);
        AddPilotInputs(givenUp, 6, -1, 0, 0, DashHeld, None);
        AddPilotInputs(givenUp, 16, -1, 0, 0, None, None);
        pilots.Add(RunPilot("기다리다 뗀 대시", field, noBodies, noKinds, DashSlots, 24, givenUp));

        // 아래 넷은 입력이 0.35초(11틱) 넘게 끊기는 시나리오다(PR #30 리뷰 1번). 서버는 마지막 입력을 받은 다음 틱부터 10틱까지 쓰고,
        // 그 뒤로는 틱마다 대원을 멈추고 버튼을 모두 뗀 것으로 본다. 클라이언트는 스스로 입력을 보내지 못한 틱을 이렇게 따라간다.

        // 쥐고 기다리던 대시는 입력이 끊기면 버려진다. 근접 타격(20틱)을 쓰는 중에 대시를 눌러 쥐고 있다가 입력이 14틱 끊긴다.
        // 끊긴 지 11틱째에 서버가 버튼을 뗀 것으로 보고 그 누름을 버린다. 타격이 끝나도 대시는 나가지 않는다.
        // 입력이 돌아와 대시 버튼을 쥐고 있다고 알려도(새 누름은 없다) 나가지 않는다. 걷기도 11틱째부터 멈췄다가 입력이 돌아오면 다시 걷는다.
        List<PilotInput?> dropped = new List<PilotInput?>();
        AddPilotInputs(dropped, 1, 1, 0, 0, None, strikeTap);
        AddPilotInputs(dropped, 1, 1, 0, 0, None, None);
        AddPilotInputs(dropped, 1, 1, 0, 0, DashHeld, DashHeld);
        AddPilotInputs(dropped, 2, 1, 0, 0, DashHeld, None);
        for (int i = 0; i < 14; i++)
        {
            dropped.Add(null);
        }
        AddPilotInputs(dropped, 8, 1, 0, 0, DashHeld, None);
        pilots.Add(RunPilot("기다리다 입력이 끊긴 대시", field, noBodies, noKinds, DashSlots, 24, dropped));

        // 대시하는 중에 입력이 오래 끊겨도 대시는 끝까지 간다. 그 뒤에는 마지막 입력으로 걷다가, 그 입력을 받은 지 11틱째부터 선다.
        List<PilotInput?> coasting = new List<PilotInput?>();
        AddPilotInputs(coasting, 1, 0, -1, 0, None, None);
        AddPilotInputs(coasting, 1, 0, -1, 0, None, DashHeld);
        for (int i = 0; i < 16; i++)
        {
            coasting.Add(null);
        }
        AddPilotInputs(coasting, 3, 1, 0, 0, None, None);
        pilots.Add(RunPilot("대시 중에 입력이 오래 끊김", field, noBodies, noKinds, DashSlots, 24, coasting));

        // 쥐고 있던 기운은 입력이 끊기면 장판이 나간다. 회전 방어를 눌러 쥔 채 입력이 끊긴다. 서버가 버튼을 뗀 것으로 보는 틱에
        // 장판이 나가고, 그때까지 이은 만큼(일곱 틱) 끝이 밀린다. 그 뒤에 눌러 쥔 대시는 그 끝에 조준한 쪽으로 나간다.
        List<PilotInput?> slipped = new List<PilotInput?>();
        AddPilotInputs(slipped, 1, 0, 0, 1, blockHeld, blockHeld);
        AddPilotInputs(slipped, 3, 0, 0, 1, blockHeld, None);
        for (int i = 0; i < 18; i++)
        {
            slipped.Add(null);
        }
        AddPilotInputs(slipped, 1, 0, 0, 1, DashHeld, DashHeld);
        AddPilotInputs(slipped, 10, 0, 0, 1, DashHeld, None);
        pilots.Add(RunPilot("기운을 쥔 채 입력이 끊김", field, noBodies, noKinds, DashSlots, 24, slipped));

        // 쓰던 기술이 끝나는 바로 그 틱에 입력 끊김 처리가 걸리면, 뗀 것으로 본 누름이 그 틱에 시작한다. 그 틱에는 이동도 멈춘 것이라
        // 대시는 걷던 쪽(오른쪽)이 아니라 조준한 쪽(아래)으로 간다. 근접 타격을 누른 지 열 틱 뒤에 대시를 눌러 쥐고 입력이 끊긴다.
        // 타격이 끝나는 틱이 마지막 입력을 받은 지 꼭 11틱째다.
        List<PilotInput?> sameTick = new List<PilotInput?>();
        AddPilotInputs(sameTick, 1, 1, 0, Math.PI / 2, None, strikeTap);
        AddPilotInputs(sameTick, 9, 1, 0, Math.PI / 2, None, None);
        AddPilotInputs(sameTick, 1, 1, 0, Math.PI / 2, DashHeld, DashHeld);
        for (int i = 0; i < 16; i++)
        {
            sameTick.Add(null);
        }
        AddPilotInputs(sameTick, 3, -1, 0, Math.PI / 2, None, None);
        pilots.Add(RunPilot("기술이 끝나는 틱에 입력 끊김이 걸림", field, noBodies, noKinds, DashSlots, 24, sameTick));

        text.Append("  \"pilots\": [\n");
        for (int i = 0; i < pilots.Count; i++)
        {
            text.Append(pilots[i]);
            if (i < pilots.Count - 1)
            {
                text.Append(',');
            }
            text.Append('\n');
        }
        text.Append("  ]\n");
    }

    private static string SlotList(int[] slots)
    {
        long[] values = new long[slots.Length];
        for (int i = 0; i < slots.Length; i++)
        {
            values[i] = slots[i];
        }
        return Row(values);
    }

    // 버튼까지 실은 입력으로 실제 Match를 한 틱씩 진행해, 틱마다의 위치와 마나, 쓰는 중인 기술의 슬롯을 적는다.
    private static string RunPilot(string name, FixedVector start, List<FixedVector> bodies, List<EnemyDefinition> kinds,
        string[] slots, int mana, List<PilotInput?> inputs)
    {
        Rules rules = new Rules { MaxEnemies = 0 };
        Match match = new Match("PARITY", rules, 73);
        Player player = match.Join("p", "pilot")!;
        player.Connected = true;
        Check(match.SetLoadout(player, slots), $"{name}: 장비를 받지 않았습니다");
        Check(match.Deploy(player, match.Layout.Camp.X.ToDouble(), match.Layout.Camp.Y.ToDouble()));
        Advance(match, rules.DeploySeconds + 0.01);
        Equal(player.State, "alive");
        player.Position = start;
        player.Mana = mana;
        for (int i = 0; i < bodies.Count; i++)
        {
            EnemyDefinition kind = kinds[i];
            EnemyDefinition still = new EnemyDefinition(kind.Id, kind.Name, kind.Radius, kind.Health, 0, kind.Skills);
            Enemy enemy = new Enemy(9000 + i, bodies[i], still);
            enemy.NextActionTick = long.MaxValue;
            match.Enemies.Add(enemy);
        }

        StringBuilder text = new StringBuilder();
        text.Append("    {\n");
        text.Append("      \"name\": \"").Append(name).Append("\",\n");
        text.Append("      \"speed\": ").Append(Number(rules.PlayerSpeed)).Append(",\n");
        text.Append("      \"radius\": ").Append(Number(Rules.PlayerRadius.Raw)).Append(",\n");
        text.Append("      \"start\": ").Append(Row(start.X.Raw, start.Y.Raw)).Append(",\n");
        text.Append("      \"mana\": ").Append(Number(mana)).Append(",\n");
        text.Append("      \"slots\": [");
        for (int i = 0; i < slots.Length; i++)
        {
            if (i > 0)
            {
                text.Append(", ");
            }
            text.Append('"').Append(slots[i]).Append('"');
        }
        text.Append("],\n");
        text.Append("      \"bodies\": [");
        for (int i = 0; i < match.Enemies.Count; i++)
        {
            Enemy enemy = match.Enemies[i];
            if (i > 0)
            {
                text.Append(", ");
            }
            text.Append(Row(enemy.Position.X.Raw, enemy.Position.Y.Raw, enemy.Definition.Radius.Raw));
        }
        text.Append("],\n");
        // 한 줄이 한 틱이다. 그 틱 전에 보낸 입력(없으면 null)과, 그 틱을 진행한 뒤의 위치(Raw)·마나·쓰는 중인 기술의 슬롯(없으면 0)이다.
        // 입력은 [이동 x, 이동 y, 조준, 누르고 있는 슬롯들, 누른 슬롯들]이다.
        text.Append("      \"ticks\": [\n");
        long sequence = 0;
        int dashes = 0;
        // 이어지는 대시는 사이에 서 있는 틱이 없으므로, 대시를 시작한 틱이 바뀌는 것으로 센다.
        long lastDashStart = -1;
        for (int i = 0; i < inputs.Count; i++)
        {
            PilotInput? input = inputs[i];
            text.Append("        [");
            if (input == null)
            {
                text.Append("null, ");
            }
            else
            {
                Check(match.Input(player, sequence, input.MoveX, input.MoveY, input.Aim, input.Held, input.Pressed), $"{name}: {i}번째 틱의 입력을 받지 않았습니다");
                sequence++;
                text.Append('[').Append(Number(input.MoveX)).Append(", ").Append(Number(input.MoveY)).Append(", ").Append(Number(input.Aim));
                text.Append(", ").Append(SlotList(input.Held)).Append(", ").Append(SlotList(input.Pressed)).Append("], ");
            }
            int manaBefore = player.Mana;
            match.Step();
            // 보급 상자 옆을 지나면 마나가 찬다. 클라이언트는 보급을 따라 하지 않으므로 그런 시나리오는 대조할 수 없다.
            Check(player.Mana <= manaBefore, $"{name}: {i}번째 틱에 보급으로 마나가 찼습니다. 보급 상자에서 떨어진 자리로 옮기세요");
            int slot = 0;
            if (player.Actions.Count > 0)
            {
                PlayerAction action = player.Actions[0];
                slot = action.Slot;
                if (action.Dashing(match.Tick) && action.StartedTick != lastDashStart)
                {
                    dashes++;
                    lastDashStart = action.StartedTick;
                }
            }
            text.Append(Number(player.Position.X.Raw)).Append(", ").Append(Number(player.Position.Y.Raw));
            text.Append(", ").Append(Number(player.Mana)).Append(", ").Append(Number(slot)).Append(']');
            if (i < inputs.Count - 1)
            {
                text.Append(',');
            }
            text.Append('\n');
        }
        text.Append("      ],\n");
        // 이 시나리오에서 실제로 시작한 대시의 수다. 시나리오가 보려는 장면이 성립했는지 클라이언트 검사가 함께 본다.
        text.Append("      \"dashes\": ").Append(Number(dashes)).Append('\n');
        text.Append("    }");
        return text.ToString();
    }

    // 멈춘 적 둘에 막혔다가 돌아가는 시나리오다. 첫 구간에서 병사에, 셋째 구간(오른쪽)에서 철위병에 막힌다.
    // 철위병 앞에서 멈춘 자리의 거리(약 38.3)는 반지름의 합(36)보다 크다. 다음 걸음(3)을 가면 합보다 가까워져(35.3) 그 자리에 선다.
    private static string BlockedScenario(EnemyDefinition warden)
    {
        double diagonal = 1 / Math.Sqrt(2);
        List<FixedVector> bodies = new List<FixedVector>();
        List<EnemyDefinition> kinds = new List<EnemyDefinition>();
        bodies.Add(FixedVector.FromInt(352, 730));
        kinds.Add(EnemyDefinition.Grunt);
        bodies.Add(FixedVector.FromInt(392, 690));
        kinds.Add(warden);
        List<double[]?> blocked = new List<double[]?>();
        AddInputs(blocked, 8, 1, 0);
        AddInputs(blocked, 8, diagonal, -diagonal);
        AddInputs(blocked, 8, 1, 0);
        AddInputs(blocked, 6, 0, 1);
        return RunScenario("멈춘 적에 막히고 돌아감", 180, FixedVector.FromInt(300, 730), bodies, kinds, blocked);
    }

    private static void BodyScenarioUsesRadius()
    {
        // 대조 자료가 큰 몸과의 충돌까지 보려면, 대원의 경로가 철위병의 반지름에 따라 달라야 한다.
        // 반지름이 하나 작으면(합 35) 그 걸음이 들어가 대원이 더 나아간다. 클라이언트가 받은 반지름을 쓰지 않으면 어긋난다.
        string actual = TickRows(BlockedScenario(EnemyDefinition.Warden));
        EnemyDefinition warden = EnemyDefinition.Warden;
        EnemyDefinition smaller = new EnemyDefinition(warden.Id, warden.Name, warden.Radius - Fixed.One, warden.Health, warden.Speed, warden.Skills);
        Check(TickRows(BlockedScenario(smaller)) != actual, "철위병의 반지름이 하나 작아도 대원의 경로가 같습니다. 대원이 철위병 몸에 막히지 않습니다");
    }

    // 시나리오에서 틱마다의 입력과 위치만 떼어 낸다. 앞부분의 몸 목록에는 반지름이 들어 있어 늘 다르다.
    private static string TickRows(string scenario)
    {
        int start = scenario.IndexOf("\"ticks\"", StringComparison.Ordinal);
        return scenario.Substring(start);
    }

    private static void AddInputs(List<double[]?> inputs, int count, double moveX, double moveY)
    {
        for (int i = 0; i < count; i++)
        {
            inputs.Add(new double[] { moveX, moveY });
        }
    }

    // 입력이 오지 않는 틱이다.
    private static void AddGap(List<double[]?> inputs, int count)
    {
        for (int i = 0; i < count; i++)
        {
            inputs.Add(null);
        }
    }

    private static string RunScenario(string name, double speed, FixedVector start, List<FixedVector> bodies, List<EnemyDefinition> kinds,
        List<double[]?> inputs)
    {
        Rules rules = new Rules { MaxEnemies = 0, PlayerSpeed = speed };
        Match match = new Match("PARITY", rules, 73);
        Player player = match.Join("p", "pilot")!;
        player.Connected = true;
        Check(match.Deploy(player, match.Layout.Camp.X.ToDouble(), match.Layout.Camp.Y.ToDouble()));
        Advance(match, rules.DeploySeconds + 0.01);
        Equal(player.State, "alive");
        player.Position = start;
        // 막는 몸은 움직이지도 행동하지도 않는 적이다. 클라이언트는 스냅샷의 적 위치로 같은 몸을 본다.
        for (int i = 0; i < bodies.Count; i++)
        {
            EnemyDefinition kind = kinds[i];
            EnemyDefinition still = new EnemyDefinition(kind.Id, kind.Name, kind.Radius, kind.Health, 0, kind.Skills);
            Enemy enemy = new Enemy(9000 + i, bodies[i], still);
            enemy.NextActionTick = long.MaxValue;
            match.Enemies.Add(enemy);
        }

        StringBuilder text = new StringBuilder();
        text.Append("    {\n");
        text.Append("      \"name\": \"").Append(name).Append("\",\n");
        text.Append("      \"speed\": ").Append(Number(speed)).Append(",\n");
        text.Append("      \"radius\": ").Append(Number(Rules.PlayerRadius.Raw)).Append(",\n");
        text.Append("      \"start\": ").Append(Row(start.X.Raw, start.Y.Raw)).Append(",\n");
        text.Append("      \"bodies\": [");
        for (int i = 0; i < match.Enemies.Count; i++)
        {
            Enemy enemy = match.Enemies[i];
            if (i > 0)
            {
                text.Append(", ");
            }
            text.Append(Row(enemy.Position.X.Raw, enemy.Position.Y.Raw, enemy.Definition.Radius.Raw));
        }
        text.Append("],\n");
        // 한 줄이 한 틱이다. 그 틱 전에 보낸 이동 입력(없으면 null)과 그 틱을 진행한 뒤의 위치(Raw)를 적는다.
        text.Append("      \"ticks\": [\n");
        long sequence = 0;
        for (int i = 0; i < inputs.Count; i++)
        {
            double[]? input = inputs[i];
            text.Append("        [");
            if (input == null)
            {
                text.Append("null, null, ");
            }
            else
            {
                Check(match.Input(player, sequence, input[0], input[1], 0), $"{name}: {i}번째 틱의 입력을 받지 않았습니다");
                sequence++;
                text.Append(Number(input[0])).Append(", ").Append(Number(input[1])).Append(", ");
            }
            match.Step();
            text.Append(Number(player.Position.X.Raw)).Append(", ").Append(Number(player.Position.Y.Raw)).Append(']');
            if (i < inputs.Count - 1)
            {
                text.Append(',');
            }
            text.Append('\n');
        }
        text.Append("      ]\n");
        text.Append("    }");
        return text.ToString();
    }

    // 한 줄에 행 하나씩 적는다.
    private static void AppendRows(StringBuilder text, string name, List<string> rows)
    {
        text.Append("  \"").Append(name).Append("\": [\n");
        for (int i = 0; i < rows.Count; i++)
        {
            text.Append("    ").Append(rows[i]);
            if (i < rows.Count - 1)
            {
                text.Append(',');
            }
            text.Append('\n');
        }
        text.Append("  ],\n");
    }

    private static string Row(params long[] values)
    {
        StringBuilder text = new StringBuilder();
        text.Append('[');
        for (int i = 0; i < values.Length; i++)
        {
            if (i > 0)
            {
                text.Append(", ");
            }
            text.Append(Number(values[i]));
        }
        text.Append(']');
        return text.ToString();
    }

    private static string Number(long value)
    {
        return value.ToString(CultureInfo.InvariantCulture);
    }

    // 실수는 되읽으면 같은 값이 되는 가장 짧은 표기로 적는다. JavaScript의 JSON.parse도 같은 실수로 읽는다.
    private static string Number(double value)
    {
        return value.ToString("R", CultureInfo.InvariantCulture);
    }

    // 대조 자료에 쓸 수를 고르는 정해진 수열(SplitMix64)이다. System.Random은 .NET 버전에 따라 수열이 바뀔 수 있어 쓰지 않는다.
    private sealed class NumberSequence
    {
        private ulong _state;

        public NumberSequence(ulong seed)
        {
            _state = seed;
        }

        public ulong Next()
        {
            unchecked
            {
                _state += 0x9E3779B97F4A7C15UL;
                ulong value = _state;
                value = (value ^ (value >> 30)) * 0xBF58476D1CE4E5B9UL;
                value = (value ^ (value >> 27)) * 0x94D049BB133111EBUL;
                return value ^ (value >> 31);
            }
        }

        // -limit 이상 limit 이하의 정수다.
        public long Between(long limit)
        {
            ulong span = (ulong)limit * 2 + 1;
            long value = (long)(Next() % span);
            return value - limit;
        }
    }
}
