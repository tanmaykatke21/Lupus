## Inspiration

It's 1:50. Your lab in Life Sciences starts at 2:00, and you're standing outside West Apartments, phone in hand.

Do you walk? Do you wait for the Outer Loop? Will the bus even have room when it shows up, right at class change?

Every Stony Brook student knows this moment. We'd open the bus tracker and see little dots crawling around a map,
but nothing told us what we actually wanted to know: **when do I need to leave, and what's the fastest way
there?** So we guessed. Sometimes we sprinted for a bus that was already gone. Sometimes we waited ten minutes
for one when walking would have gotten us there sooner.

Tens of thousands of students, faculty and hospital staff cross this campus every day, and most of them are
guessing too. We wanted an app that just says *"leave in six minutes, and walk briskly."* That became **Lupus**,
named after our wolf and given the voice of a friendly old train conductor.

## What it does

You tell Lupus your class schedule once. From then on it knows where you need to be next. It works out whether
walking or the bus is faster right now and counts down to the moment you should head out. A little pressure
gauge tells you whether you can stroll or need to hurry.

Tap **Guide me** and your phone becomes a compass that points the way, bus ride included, while the conductor reads
directions aloud in your language. If your bus is packed, Lupus finds another way and tells you why. And if you'd
rather just ask, you can type or say *"Will I make my 2 o'clock lab?"* and get a straight answer.

It also helps you catch the LIRR into the city, and it can plan routes without stairs for anyone who needs them.

## How we built it

We started with the one thing everything else depends on: knowing where the buses really are. We studied the
campus bus feed and started recording it, so we'd have history to learn from and could replay real buses even
when none were running.

Next we had to teach Lupus how people actually walk around campus. Ordinary maps don't know the shortcut through
the library or the path behind the dorms. So we mapped campus by hand: buildings, footpaths the maps were missing,
and indoor cut-throughs, along with the hours each building is open.

With buses and walking in place, we built the part that does the thinking. It compares every sensible way to get
somewhere and works backwards from your deadline:

$$
\text{leave by} = \text{when you need to be there} - \text{how long the trip takes}
$$

After that came the features that make it feel personal: the class schedule, the compass, the conductor's voice
in seven languages, and an AI assistant you can just talk to. We were careful with the AI. It only understands
your question. Every time and bus it tells you comes from our own planner, so it can't make anything up.

## Challenges we ran into

- **Campus is harder to map than it looks.** The first routes we got cut straight through parking lots and missed
  obvious paths. A lot of our time went into walking the map, building by building, until the routes made sense.
- **Buses don't follow the schedule.** Predictions drift, buses bunch up, and "full" doesn't always mean full,
  since students can still squeeze on standing. We had to learn what the data really meant before we could trust it.
- **Phones are protective.** Sound, location and the compass all need the user's permission, and each phone asks
  differently. Getting a voice to speak and a compass to turn at the right moment took more care than we expected.
- **Weekends are quiet.** Hardly any buses run on weekends, which is exactly when we were building and demoing.
  Recording real buses during the week and replaying them became our safety net.
- **Keeping the AI honest.** It's easy for an AI to sound confident about a bus that doesn't exist. We designed
  ours so it never gets the chance.

## Accomplishments that we're proud of

Lupus knows our campus better than any general map app: its shortcuts, its buses, and when walking beats waiting.
It's honest when the bus isn't worth it. It keeps working when a service it relies on goes down. And it's ready to
use in any phone browser, with nothing to install.

## What we learned

- **Getting the details right matters more than looking polished.** The hardest and most valuable work was making
  the routes and times *correct*.
- **Plan for things to break.** Live feeds go quiet and services hit their limits, so we gave every piece a backup
  plan.
- **AI is best as a helper, not an oracle.** Letting it understand people while our own code supplies the facts gave
  us the best of both.
- **Build for real people.** Thinking about students who need step-free routes, or who think in another language,
  made the app better for everyone.

## What's next for Lupus

We want Lupus to nudge you to leave even when the app is closed, to plan trips with a transfer between two buses,
and to work directly with Stony Brook's transit and class systems so setup takes seconds. Most of all, we want
every Seawolf to stop guessing and just know when to leave.
