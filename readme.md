# BOMBER CHESS ボンバーチェス

Chess that alternates with Bomberman on the same board, for 2–5 players.

## Play with friends on your network (LAN)

1. On one computer, run `npm start` (or `node server.js`). You only need Node.js 16 or newer, and there's nothing to install.
2. The server prints a URL like `http://192.168.1.95:8765`. Everyone on the same Wi-Fi opens it in a browser.
3. Everyone picks **LAN GAME** and joins a seat. The first person to connect is the host and presses **START GAME**.

- If someone disconnects, a CPU takes over their seat. Reloading the page puts them back in it.
- Two people can share one keyboard by taking two seats in the same browser. They use different key sets.
- Open seats are filled by CPU players when the game starts. The host sets how smart they are with the **BRAIN SIZE OF CPU** slider (see [CPU players](#cpu-players)).
- The host also sets the **TURN TIME** for each chess turn and how many power-ups lie on the chessboard with the **POWER-UPS** slider (see [Chess phase](#chess-phase)). The host can also switch **CHAINED DEATHS** (see [Special captures](#special-captures)) and **SHEEP GATES** (see [Sheep gates](#sheep-gates)) on, and pick the chess round the gates open in, and switch on **PLAYERS CAN REVIVE** (see [Bomber phase](#bomber-phase)) and **BLOOD** (see [Blood](#blood)).
- Press **Esc** or click **MENU** during a game to get the in-game menu:
  - **LEAVE GAME** hands your seat to a CPU for good and takes you back to the lobby. You won't be pulled back into the match.
  - **END GAME FOR ALL** (host only) sends everyone back to the lobby.
  - **QUIT TO TITLE** leaves the game and disconnects.
- While a game is running, the lobby lets you **WATCH** it, or take over a CPU seat to join in.

## Play on one computer

Open `index.html` directly, or use the URL above, and pick **LOCAL GAME**. The setup screen has the same settings as the LAN lobby, including **TURN TIME**, **BRAIN SIZE OF CPU**, **POWER-UPS**, **CHAINED DEATHS**, **SHEEP GATES**, **PLAYERS CAN REVIVE** and **BLOOD**. Press **Esc** or click **MENU** to pause or quit.

## In-game help

- A column down the right edge of the screen shows every power-up. Click one to see how it works, and click anywhere else to close the card.

## Chess phase

- When it's your turn, a **YOUR TURN!** banner sweeps across the screen with a fanfare. Click or press **Enter** to skip it. Other players' turns get a smaller banner across the board. A nameplate on the top edge of the board shows whose turn it is and the seconds left.
- Every turn has a time limit: **TURN TIME** in the lobby, from 15 seconds to 2 minutes in 15-second steps (30 seconds by default). The last 5 seconds of your turn tick down and the board's edge flashes red. Run out of time and you lose that turn, which counts as one of the round's moves, and a sheep appears on a random free square.
- Move a piece onto a sheep, or slide across it, and the sheep stampedes. It runs around in knight jumps until it tramples a piece or bumps into another sheep, just like the knight's strike. It never tramples the piece that spooked it, and it leaves kings alone. A sheep it bumps into stampedes next, so one sheep can set off a whole chain of them (with or without **CHAINED DEATHS**).
- The more sheep a chain of stampedes sets running, the bigger the bang at the end: when a sheep in the chain runs into a piece, it blows up and takes every square up to half the number of sheep so far with it (rounded down). For example, the 6th sheep of a chain blows up everything up to 3 squares around it. A single sheep doesn't blow up. Kings put their helmets on, and sheep caught in the blast stampede next, which makes the chain longer still.
- Click any piece to see where it can move, even when it isn't your turn. You can only move your own pieces on your turn.
- A pawn standing on its side's pawn row can move 1 or 2 steps, and that includes a revived pawn.
- A piece that slides over several squares picks up every power-up along its path. A pawn's double step counts too.
- The **POWER-UPS** slider sets how many power-ups lie on the board. The board is topped up at the start of every chess round. The five steps are **CHILLIN'** (half the usual amount), **MILD** (three quarters), **MEDIUM** (the default), **SPICY** (twice as many) and **INSANITY** (four times as many, so about every second free square on the 2-player board).
- If you're checkmated, you're out, and your king calls in a nuke on its way out.

## Bomber phase

- Everyone plays, including players who are already out of the chess game, so they can still mess with the others.
- If you get hit, you're out for the rest of the round and lose a pawn when chess resumes. If you have no pawns left, you lose one of your other pieces instead (a rook, knight, bishop or queen, one that can go without leaving your king in check if there is one), and it sets off its strike like a captured piece would (see [Special captures](#special-captures)). If all you have left is your king, you're out of the game.
- A hit never takes a pawn that's shielding your king from check. If every pawn you have is shielding it, a pawn you'd get back this round (see below) pays instead. If you have none coming back, you lose a random rook, bishop or knight that can go safely, never your queen. Only if no piece can go without leaving you in check do you lose a pawn anyway.
- If you blow up another player, one of your lost pawns comes back on a free starting square (or, if your side of the board is full, on the free square nearest your king). This doesn't apply if you're already out of the chess game.
- With **PLAYERS CAN REVIVE** on, a player who is out of the chess game and wins a bomber round (the last bomber standing) is back in: their king lands on a free square near where it started, and their kills from that round bring back pawns as usual. Their old pieces stay neutral.
- The round runs for the full **BOMBER TIME** set in the lobby. If only one bomber is left standing, it ends right away and chess resumes.
- From the third bomber round, the walls close in for good. Each round starts with the walls the earlier rounds left behind. While it runs, one more row along the edge turns into wall, swept in from every side at once. The bomber arena gets smaller every round until only the two innermost rows are left. A cell blinks red before its block drops. Anyone still standing there is crushed, shield or not, and counts as hit. The walls only exist in the bomber rounds: chess is always played on the whole board.
- **FLAMEPASS** is a shield. It blocks one blast, then breaks.
- **KICK** gives you 3 kicks for every one you pick up, and you keep them until you use them. Run into a bomb and it slides away along the line, until it stops against a piece, a wall, another bomb or a bomber. Each kick uses one up. With **BOMBPASS** too, you kick the bomb instead of walking over it. You only walk over it if it can't move.
- **X-BOMB** turns your bombs for the next bomber round into two sticks of dynamite crossed like an X. Their fire spreads along the diagonals (the bishop lines) instead of straight. On the triangle and pentagon boards the sticks point along those boards' bishop lines.

## Special captures

Capturing any piece except a pawn sets off a strike. Strikes can hit anyone's pieces, including your own, and sheep, but never a king. No strike can knock a player out of the game.

| Captured piece | What happens |
| --- | --- |
| Rook | The tower splits and falls along the rook lines. It crushes every piece up to 2 steps away. The piece that captured the rook is safe. |
| Knight | The knight wakes up and grows eyes and legs. It gallops around in knight jumps until it runs into a piece or a sheep, then tramples it (a sheep just gets spooked). It never attacks the piece that captured it, and it leaves kings alone. |
| Bishop | A bolt of lightning hits one random piece or sheep on the board, never a king. |
| Queen | A plane flies across the board and drops a few bombs at random spots along its path. Any piece where a bomb lands is destroyed. |
| King | A nuke hits a random spot and destroys everything in a 4×4 area. A checkmate also sets one off. |

- During the falling tower, the airstrike and the nuke, every king puts on a helmet, and anything that lands on it bounces off.
- A sheep hit by a strike isn't hurt. It loses some wool, gets spooked and stampedes once the strike is over, with or without **CHAINED DEATHS**.
- With **CHAINED DEATHS** off (the default), pieces destroyed by a strike don't set off their own strike. Switch it on in the lobby, and any knight, bishop, rook or queen killed by a strike (or by a stampeding sheep) sets off its own strike next. For example, the falling tower crushes a queen, her airstrike hits a rook, and down comes another tower. The strikes go off one after another until the chain runs out.
- The game waits for the strike to finish before the next turn starts.
- On the triangle and pentagon boards, the falling rook and the 4×4 nuke area use the same rook lines and cell sizes as everywhere else on those boards.
- When you aim at a piece you can capture, the game shows which strike it will set off. For a rook, it also highlights where the tower will fall.

## Sheep gates

Switch **SHEEP GATES** on in the lobby (or on the local setup screen) and the board sits in a fenced sheep pasture, with a wooden gate set into the board's frame at its corners. The 4-player cross board has its gates in the four inner corners, and the other boards have them at their outer corners, between the players' sides. A sheep waits behind every gate, and a sign under the board counts down the rounds.

- The gates swing open when the chess round set with **GATES OPEN IN ROUND** starts, and stay open. That row shows up under **SHEEP GATES** once they're on. It goes from 1 (open from the start) to 12, and the default is 6 (after 5 full chess rounds). At the start of that round and every chess round after it, each gate lets one sheep jump in onto a free square next to its corner. Each board holds at most 3 of these sheep per gate.
- The sheep from the gates wear a bell. After every turn, each one wanders one step, straight or diagonal, to a random free square. They never step onto pieces, other sheep or power-ups.
- They don't block anything: pieces move past and over them as usual. Like the sheep from a missed turn, a sheep that a piece steps on or slides across stampedes in knight jumps until it tramples a piece or bumps into another sheep.
- Sheep from missed turns still stay put.

## Blood

Switch **BLOOD** on in the lobby (or on the local setup screen) for gore. A sheep that blows up at the end of a chain of stampedes bursts into bloody bits: its head, legs, lumps of wool and a bone. A sheep caught by a strike bleeds and loses bloody tufts of wool. A bomber that gets blown up bursts into its head, arms, body and legs, and one squashed by a falling wall squirts blood and an arm and a leg out from under it. The blood and some of the body parts stay on the ground for the rest of the round, and fade away when the board flips.

## CPU players

Set how smart the CPUs are with the **BRAIN SIZE OF CPU** slider, before each game, in the LAN lobby or on the local setup screen. It goes from **STUPID** to **GRANDMASTER**:

| Brain size | Chess | Bomber round |
| --- | --- | --- |
| STUPID | Plays random moves almost half the time and can even miss a king it could take. | Slow and panicky. Walks into blasts and closing walls. |
| DIM | Blunders often and rarely checks whether its pieces are safe. | Slow to react, and often doesn't notice fresh bombs. |
| AVERAGE (default) | The classic beatable CPU. It often forgets to check whether a square is safe and sometimes plays a random move. | Reacts slowly and now and then runs the wrong way. |
| SHARP | Looks two moves ahead, plus the captures that follow. | Quick. Sees chain reactions and gets away from closing walls early. |
| GRANDMASTER | Looks 3–5 moves ahead (fewer on the bigger boards), plus the captures that follow, and plans for the falling rook tower. | Very quick and never panics. Hunts you down, kicks bombs at you and heads for the middle before the walls close in. |

In the bomber round every CPU plays a bit like a person, the sharp ones just less so. Each one gets its own pace, nerves and trigger finger for the round. It walks to a spot and stops to look around, picks its own way there, sometimes zones out or slips a step, drops a bomb on a whim (more often with someone close by), and doesn't always go after the nearest player or right up to them.

The CPUs that look ahead think a few milliseconds per frame, so the game never freezes while they decide. You can tune every level with the `IQ` table at the top of `js/ai.js`.

## Developer

`npm run sim` plays CPU-only games headlessly to check the game logic. `node tools/sim.js [games] [brain 0-4] [chain] [gates] [revive] [gate=<round>] [pu=<0-4>]` sets the number of games per board and the CPU brain size, `chain` switches chained deaths on, `gates` switches sheep gates on, `revive` lets players revive, `gate=` sets the round they open in and `pu=` the power-up amount.
