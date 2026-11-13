using Argus.Server.Game;
using static TestTools;

// 입력을 순번대로 보내는 도우미다. 검사가 버튼을 누르고 떼는 장면을 클라이언트처럼 만든다.
// 입력의 held는 그 입력을 보내는 순간에 누르고 있는 슬롯 전부, pressed는 지난 입력 뒤에 누른 슬롯을 누른 차례대로 적은 것이다.
// 슬롯 하나만 다루는 장면이 대부분이라, 정수를 받는 메서드는 슬롯 하나(0이면 없음)를 뜻한다. 버튼 둘을 함께 누르고 있는 장면은
// 배열을 받는 Send를 쓴다. 대원은 오른쪽(+x)을 조준하고 움직이지 않는다.
internal sealed class Pad
{
    public Fixture F { get; }
    private long _sequence;

    // 마나를 가득 채운 새 대원으로 시작한다.
    public Pad()
    {
        F = new Fixture();
        F.Player.Mana = 24;
    }

    // 이미 꾸민 방의 대원으로 입력을 보낸다.
    public Pad(Fixture fixture)
    {
        F = fixture;
    }

    // 입력 하나를 보낸다. 틱은 진행하지 않는다. 한 틱 사이에 입력이 여럿 도착하는 장면을 만들 때 거듭 부른다.
    public void Send(int[] held, int[] pressed)
    {
        Check(F.Match.Input(F.Player, _sequence, 0, 0, 0, held, pressed));
        _sequence++;
    }

    public void Send(int held, int pressed)
    {
        Send(Slots(held), Slots(pressed));
    }

    // 입력 하나를 보내고 한 틱 진행한다.
    public void Play(int held, int pressed)
    {
        Send(held, pressed);
        F.Match.Step();
    }

    // 클라이언트처럼 틱마다 입력을 하나씩 보내며 ticks틱 진행한다. 입력 없이 시간을 흘리면 0.35초 뒤 입력 끊김 처리가
    // 누르고 있던 버튼을 뗀 것으로 만들어, 버튼이 눌린 채 남는 결함을 가린다.
    public void Run(int held, int ticks)
    {
        for (int i = 0; i < ticks; i++)
        {
            Play(held, 0);
        }
    }

    // 버튼을 누른 입력(누름과 누르고 있음)을 보내고 한 틱 진행한다.
    public void Press(int slot)
    {
        Play(slot, slot);
    }

    // 버튼을 짧게 눌렀다 뗀 입력(누름만 있고 누르고 있는 버튼은 없음)을 보내고 한 틱 진행한다.
    public void Tap(int slot)
    {
        Play(0, slot);
    }

    // 지금 기술이 끝나는 틱까지 ticksLeft틱이 남을 때까지 held를 틱마다 보내며 진행한다.
    // ticksLeft가 1이면 다음 Step이 기술이 끝나는 틱이라 새 기술을 시작할 수 있고, 2이면 다음 Step까지는 기술을 쓰는 중이다.
    public void RunUntilBusyLeft(int held, long ticksLeft)
    {
        while (F.Player.Actions.Count > 0 && F.Player.Actions[0].EndsTick - F.Match.Tick > ticksLeft)
        {
            Play(held, 0);
        }
    }
}
