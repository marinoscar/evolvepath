import type { Equipment, MovementPattern, PrismaClient } from '@prisma/client';

// =============================================================================
// The starter exercise catalog (issue #72, epic E09)
// =============================================================================
//
// PRD §37 asks the program builder to offer substitutions, and PRD §39 fixes
// what an exercise object is. Both need a catalog that exists before any user
// does, which is why this lives in the seed rather than in a migration or in the
// builder's prompt:
//
//   - A MIGRATION would freeze the rows. Adding a movement later, or fixing an
//     instruction, would mean a data migration over a table the product reads
//     but never rewrites.
//   - THE PROMPT would make the catalog a model output. The whole point of
//     `substitutionGroup` is that "what can I do instead of a lat pulldown?" is
//     a lookup, answerable with the provider down (PRD §120).
//
// `contraindicationTags` uses a FIXED vocabulary, repeated as
// `CONTRAINDICATION_TAGS` in `workout-program-rules.ts`: the safety rules
// intersect it with tags derived from the user's stated limitations, and a free
// vocabulary would make that intersection silently empty.
// =============================================================================

/** The only tags a catalog row may carry. Mirrored by the program rules. */
export const CONTRAINDICATION_TAGS = [
  'shoulder',
  'knee',
  'lower_back',
  'wrist',
  'hip',
  'elbow',
  'neck',
  'overhead',
] as const;

export type ContraindicationTag = (typeof CONTRAINDICATION_TAGS)[number];

export interface CatalogExercise {
  name: string;
  equipment: Equipment[];
  movementPattern: MovementPattern;
  instructions: string;
  contraindicationTags: ContraindicationTag[];
  substitutionGroup: string;
}

/**
 * `name.trim().toLowerCase()` with runs of whitespace collapsed.
 *
 * DELIBERATELY duplicated by `ExerciseResolverService` (E09-02) rather than
 * imported from it: this file runs under ts-node in the seed process, before
 * anything in `src/` is compiled, and must not pull in Nest.
 */
export function exerciseNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export const EXERCISES: CatalogExercise[] = [
  // ---------------------------------------------------------------- horizontal push
  {
    name: 'Barbell Bench Press',
    equipment: ['BARBELL', 'BENCH'],
    movementPattern: 'PUSH_H',
    instructions:
      'Lie flat on the bench with your feet planted and shoulder blades pulled back and down. Grip the bar a little wider than shoulder width, unrack it over your chest, then lower it under control to the lower part of your sternum. Keep your elbows at roughly 45 degrees from your torso rather than flared straight out, touch the chest lightly, and press back to a locked-out position without letting your hips leave the bench.',
    contraindicationTags: ['shoulder', 'wrist'],
    substitutionGroup: 'horizontal_push',
  },
  {
    name: 'Dumbbell Bench Press',
    equipment: ['DUMBBELL', 'BENCH'],
    movementPattern: 'PUSH_H',
    instructions:
      'Sit on the bench with a dumbbell on each thigh, then kick them up as you lie back so they start at chest height. Press both dumbbells up until your arms are straight, keeping your wrists stacked over your elbows. Lower until your upper arms are roughly level with your torso, pause, and press again. The dumbbells let each side travel its own natural path, which is usually kinder to the shoulder than a fixed bar.',
    contraindicationTags: ['shoulder'],
    substitutionGroup: 'horizontal_push',
  },
  {
    name: 'Incline Dumbbell Press',
    equipment: ['DUMBBELL', 'BENCH'],
    movementPattern: 'PUSH_H',
    instructions:
      'Set the bench to about 30 degrees — steeper than that turns this into a shoulder press. Start with the dumbbells at the outside of your upper chest, press up and slightly in until your arms are straight, then lower under control. Keep your ribs down and your lower back in light contact with the bench rather than arched away from it.',
    contraindicationTags: ['shoulder'],
    substitutionGroup: 'horizontal_push',
  },
  {
    name: 'Machine Chest Press',
    equipment: ['MACHINE'],
    movementPattern: 'PUSH_H',
    instructions:
      'Adjust the seat so the handles sit level with the middle of your chest. Press the handles away until your arms are straight without locking hard, then return under control until your hands are roughly level with your chest. The fixed path means you can push closer to your limit safely, which makes this a good substitute when shoulders are cranky or you are training alone.',
    contraindicationTags: [],
    substitutionGroup: 'horizontal_push',
  },
  {
    name: 'Push-Up',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'PUSH_H',
    instructions:
      'Start in a plank with your hands under your shoulders and your body in one line from head to heels. Lower your chest towards the floor with your elbows tracking back at about 45 degrees, touch lightly, and press back up without letting your hips sag or pike. If full range is too hard, raise your hands onto a bench or a wall rather than shortening the range.',
    contraindicationTags: ['wrist', 'shoulder'],
    substitutionGroup: 'horizontal_push',
  },

  // ------------------------------------------------------------------ vertical push
  {
    name: 'Barbell Overhead Press',
    equipment: ['BARBELL'],
    movementPattern: 'PUSH_V',
    instructions:
      'Hold the bar at collarbone height with your hands just outside your shoulders and your elbows slightly in front of the bar. Brace your midsection, tuck your chin back so the bar can pass your face, and press straight up until it finishes over the middle of your head. Lower under control to the collarbones. Do not lean back to make the press easier — squeeze your glutes and keep your ribs stacked over your hips.',
    contraindicationTags: ['shoulder', 'overhead', 'lower_back'],
    substitutionGroup: 'vertical_push',
  },
  {
    name: 'Dumbbell Shoulder Press',
    equipment: ['DUMBBELL'],
    movementPattern: 'PUSH_V',
    instructions:
      'Seated or standing, start with the dumbbells at ear height and your palms facing forward or slightly inward. Press up until your arms are straight, letting the dumbbells drift towards each other at the top. Lower under control until your elbows are just below shoulder height. Stop the set if the shoulder pinches at the top rather than pushing through it.',
    contraindicationTags: ['shoulder', 'overhead'],
    substitutionGroup: 'vertical_push',
  },
  {
    name: 'Machine Shoulder Press',
    equipment: ['MACHINE'],
    movementPattern: 'PUSH_V',
    instructions:
      'Set the seat so the handles start at about shoulder height. Press up along the machine path until your arms are straight, then return until your hands are level with your ears. The supported back and fixed path make this the gentlest overhead option and a sensible substitution when free-weight pressing bothers you.',
    contraindicationTags: ['overhead'],
    substitutionGroup: 'vertical_push',
  },
  {
    name: 'Pike Push-Up',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'PUSH_V',
    instructions:
      'From a push-up position, walk your feet in and lift your hips so your body makes an inverted V. Keeping that shape, bend your elbows to lower the crown of your head towards the floor between your hands, then press back up. Raising your feet onto a step makes it harder; taking the hips lower makes it easier.',
    contraindicationTags: ['shoulder', 'overhead', 'wrist', 'neck'],
    substitutionGroup: 'vertical_push',
  },

  // ---------------------------------------------------------------- horizontal pull
  {
    name: 'Seated Cable Row',
    equipment: ['CABLE', 'MACHINE'],
    movementPattern: 'PULL_H',
    instructions:
      'Sit tall with a slight bend in your knees and your chest up. Pull the handle to your lower ribs, leading with your elbows and letting your shoulder blades slide together at the end. Return under control, allowing your shoulder blades to travel forward but keeping your lower back from rounding. Do not rock your torso back and forth to move the weight.',
    contraindicationTags: [],
    substitutionGroup: 'horizontal_pull',
  },
  {
    name: 'Dumbbell Row',
    equipment: ['DUMBBELL', 'BENCH'],
    movementPattern: 'PULL_H',
    instructions:
      'Put one hand and the same-side knee on a bench so your back is roughly parallel to the floor. Let the dumbbell hang straight down, then row it towards your hip, keeping your elbow close to your side and your torso still. Lower all the way until your arm is straight. The supported position keeps the load off your lower back.',
    contraindicationTags: [],
    substitutionGroup: 'horizontal_pull',
  },
  {
    name: 'Barbell Row',
    equipment: ['BARBELL'],
    movementPattern: 'PULL_H',
    instructions:
      'Hinge at the hips until your torso is about 45 degrees from the floor, with a flat back and soft knees. Row the bar to your lower ribs and lower it under control to arms length. The hinge is held for the whole set, so this asks a lot of the lower back — swap to a supported row if your back is the limiting factor rather than your upper back.',
    contraindicationTags: ['lower_back'],
    substitutionGroup: 'horizontal_pull',
  },
  {
    name: 'Inverted Row',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'PULL_H',
    instructions:
      'Set a bar at waist height, lie underneath it and grip it a little wider than your shoulders. With your body in one straight line, pull your chest to the bar and lower under control. Walking your feet further out makes it harder; bending your knees and keeping your feet closer makes it easier, so the difficulty is adjustable without any weight.',
    contraindicationTags: [],
    substitutionGroup: 'horizontal_pull',
  },
  {
    name: 'Band Row',
    equipment: ['BAND'],
    movementPattern: 'PULL_H',
    instructions:
      'Anchor a band at chest height, or loop it around your feet while seated. Sit or stand tall, pull the band towards your lower ribs, and squeeze your shoulder blades together at the end of the pull. Return slowly against the band rather than letting it snap back. Step further from the anchor for more tension.',
    contraindicationTags: [],
    substitutionGroup: 'horizontal_pull',
  },

  // ------------------------------------------------------------------ vertical pull
  {
    name: 'Lat Pulldown',
    equipment: ['CABLE', 'MACHINE'],
    movementPattern: 'PULL_V',
    instructions:
      'Set the thigh pad so you stay seated, grip the bar a little wider than your shoulders, and lean back only slightly. Pull the bar to your upper chest by driving your elbows down and back, then let it rise all the way until your arms are straight and your shoulder blades lift. Avoid pulling behind your neck.',
    contraindicationTags: ['overhead'],
    substitutionGroup: 'vertical_pull',
  },
  {
    name: 'Pull-Up',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'PULL_V',
    instructions:
      'Hang from the bar with your hands a little wider than your shoulders and your shoulders pulled down away from your ears. Pull until your chin clears the bar, keeping your ribs down rather than swinging, then lower all the way under control until your arms are straight. If you cannot yet do one, use the assisted or band version instead of kipping.',
    contraindicationTags: ['shoulder', 'elbow', 'overhead'],
    substitutionGroup: 'vertical_pull',
  },
  {
    name: 'Assisted Pull-Up',
    equipment: ['MACHINE', 'BAND'],
    movementPattern: 'PULL_V',
    instructions:
      'Use the assist machine or loop a band under your knee or foot. Take the same grip and shape as a pull-up and use the least assistance that lets you finish your reps with the chin clearing the bar and a full hang between reps. Reduce the assistance a little once you can hit the top of the rep range cleanly.',
    contraindicationTags: ['shoulder', 'overhead'],
    substitutionGroup: 'vertical_pull',
  },
  {
    name: 'Band Pulldown',
    equipment: ['BAND'],
    movementPattern: 'PULL_V',
    instructions:
      'Anchor a band above head height — a door anchor or a beam works. Kneel or stand far enough away that the band is under tension with your arms straight overhead. Pull your hands down and out towards your chest, leading with the elbows, then return slowly. This is the substitution when there is no cable machine or pull-up bar in the room.',
    contraindicationTags: ['overhead'],
    substitutionGroup: 'vertical_pull',
  },

  // -------------------------------------------------------------------------- squat
  {
    name: 'Goblet Squat',
    equipment: ['DUMBBELL', 'KETTLEBELL'],
    movementPattern: 'SQUAT',
    instructions:
      'Hold a single dumbbell or kettlebell against your chest with both hands, elbows tucked in. Stand about shoulder-width with your toes turned slightly out. Sit down between your hips, keeping your chest up and your knees tracking over your toes, until your thighs are at least parallel. Drive back up through your whole foot. The front-loaded weight makes it self-correcting: if you lean forward, the weight tells you.',
    contraindicationTags: ['knee'],
    substitutionGroup: 'squat',
  },
  {
    name: 'Barbell Back Squat',
    equipment: ['BARBELL'],
    movementPattern: 'SQUAT',
    instructions:
      'Set the bar across your upper back, not your neck, and take it out of the rack with your feet about shoulder width. Brace, break at the hips and knees together, and descend until your thighs are at least parallel while keeping your torso angle steady. Drive up without letting your hips shoot back first. Always squat in a rack with the safety pins set.',
    contraindicationTags: ['knee', 'lower_back'],
    substitutionGroup: 'squat',
  },
  {
    name: 'Leg Press',
    equipment: ['MACHINE'],
    movementPattern: 'SQUAT',
    instructions:
      'Sit with your whole back against the pad and your feet about shoulder width on the platform. Lower the platform until your knees reach about 90 degrees, stopping before your lower back rounds off the pad, then press back without snapping your knees straight. The supported back makes this the usual substitution when squatting bothers the lower back.',
    contraindicationTags: ['knee'],
    substitutionGroup: 'squat',
  },
  {
    name: 'Hack Squat',
    equipment: ['MACHINE'],
    movementPattern: 'SQUAT',
    instructions:
      'Set your shoulders under the pads with your back flat against the machine and your feet in the middle of the platform. Release the safeties, lower until your thighs are about parallel, and press back up through your whole foot. The fixed path takes balance out of the movement, so you can push close to your limit with a clear stopping point.',
    contraindicationTags: ['knee'],
    substitutionGroup: 'squat',
  },
  {
    name: 'Bodyweight Squat',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'SQUAT',
    instructions:
      'Stand about shoulder width with your toes slightly out and your arms in front of you for balance. Sit down and back until your thighs are at least parallel, keeping your heels down and your chest up, then stand back up. Slow the lowering phase down to three seconds when the reps start to feel easy — that is the progression here, not more reps forever.',
    contraindicationTags: ['knee'],
    substitutionGroup: 'squat',
  },

  // -------------------------------------------------------------------------- hinge
  {
    name: 'Barbell Romanian Deadlift',
    equipment: ['BARBELL'],
    movementPattern: 'HINGE',
    instructions:
      'Stand holding the bar at your thighs with soft knees. Push your hips straight back, letting the bar stay in contact with your legs, until you feel a strong stretch in your hamstrings and your back is still flat — usually just below the knee. Stand back up by driving your hips forward. This is a hip hinge, not a squat: the knee angle barely changes.',
    contraindicationTags: ['lower_back', 'hip'],
    substitutionGroup: 'hinge',
  },
  {
    name: 'Dumbbell Romanian Deadlift',
    equipment: ['DUMBBELL'],
    movementPattern: 'HINGE',
    instructions:
      'Hold a dumbbell in each hand in front of your thighs. With soft knees, push your hips back and let the dumbbells travel down the front of your legs until you feel your hamstrings load and your back is about to round. Return by squeezing your glutes. The dumbbells make the load easier to bail out of than a bar, which is why beginners start here.',
    contraindicationTags: ['lower_back'],
    substitutionGroup: 'hinge',
  },
  {
    name: 'Trap Bar Deadlift',
    equipment: ['BARBELL'],
    movementPattern: 'HINGE',
    instructions:
      'Step inside the trap bar, grip the handles at your sides, set your hips somewhere between a squat and a hinge, and stand up by pushing the floor away. Lower under control by pushing your hips back. The neutral handles keep the load in line with your body, which is usually the most back-friendly way to pick heavy things up.',
    contraindicationTags: ['lower_back'],
    substitutionGroup: 'hinge',
  },
  {
    name: 'Kettlebell Swing',
    equipment: ['KETTLEBELL'],
    movementPattern: 'HINGE',
    instructions:
      'Stand a little wider than shoulder width with the bell a foot in front of you. Hike it back between your legs, then snap your hips forward so it floats up to about chest height — the arms guide, they do not lift. Let it fall back into the next hinge. Stop the set the moment the movement turns into a squat or your back rounds.',
    contraindicationTags: ['lower_back'],
    substitutionGroup: 'hinge',
  },
  {
    name: 'Glute Bridge',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'HINGE',
    instructions:
      'Lie on your back with your knees bent and your heels a hand-width from your hips. Push through your heels to lift your hips until your body makes a straight line from knees to shoulders, squeeze for a second, then lower under control. Keep your ribs down so the movement comes from your hips rather than from arching your back.',
    contraindicationTags: [],
    substitutionGroup: 'hinge',
  },
  {
    name: 'Machine Leg Curl',
    equipment: ['MACHINE'],
    movementPattern: 'HINGE',
    instructions:
      'Set the pad just above your heels and the knee joint in line with the machine pivot. Curl your heels towards your hips, pause briefly at the end, and return slowly without letting the weight stack slam down. This trains the hamstrings with no load on the spine, which makes it the usual substitute when hinging is off the table.',
    contraindicationTags: [],
    substitutionGroup: 'hinge',
  },

  // -------------------------------------------------------------------------- lunge
  {
    name: 'Walking Lunge',
    equipment: ['BODYWEIGHT', 'DUMBBELL'],
    movementPattern: 'LUNGE',
    instructions:
      'Step forward into a lunge, lowering until your back knee is just above the floor and your front shin is roughly vertical. Push through the front foot to stand and step straight into the next lunge with the other leg. Keep your torso upright. Add dumbbells at your sides once bodyweight sets feel steady.',
    contraindicationTags: ['knee'],
    substitutionGroup: 'lunge',
  },
  {
    name: 'Reverse Lunge',
    equipment: ['BODYWEIGHT', 'DUMBBELL'],
    movementPattern: 'LUNGE',
    instructions:
      'From standing, step backwards and lower until your back knee is just above the floor, then push through the front heel to return to standing. Stepping back rather than forward keeps the front knee travelling less, which is why this is the first lunge to try when knees complain.',
    contraindicationTags: ['knee'],
    substitutionGroup: 'lunge',
  },
  {
    name: 'Bulgarian Split Squat',
    equipment: ['BODYWEIGHT', 'DUMBBELL', 'BENCH'],
    movementPattern: 'LUNGE',
    instructions:
      'Place the top of your back foot on a bench behind you and hop the front foot far enough forward that your front shin stays near vertical at the bottom. Lower until your back knee is close to the floor, then drive back up through the front foot. Hold the bench or a wall for balance while you learn the position.',
    contraindicationTags: ['knee', 'hip'],
    substitutionGroup: 'lunge',
  },
  {
    name: 'Step-Up',
    equipment: ['BODYWEIGHT', 'DUMBBELL', 'BENCH'],
    movementPattern: 'LUNGE',
    instructions:
      'Set a box or bench at about knee height. Put one whole foot on it and stand up by pushing through that foot, resisting the urge to push off the floor with the back leg. Lower yourself under control rather than dropping. Do all the reps on one side before switching, and lower the box if your knee caves inward.',
    contraindicationTags: ['knee'],
    substitutionGroup: 'lunge',
  },

  // -------------------------------------------------------------------------- carry
  {
    name: "Farmer's Carry",
    equipment: ['DUMBBELL', 'KETTLEBELL'],
    movementPattern: 'CARRY',
    instructions:
      'Pick up a heavy weight in each hand, stand tall with your shoulders back and your ribs down, and walk in a straight line with short, controlled steps. Do not lean or shrug. Distance or time is the unit here, and grip is usually what runs out first.',
    contraindicationTags: [],
    substitutionGroup: 'carry',
  },
  {
    name: 'Suitcase Carry',
    equipment: ['DUMBBELL', 'KETTLEBELL'],
    movementPattern: 'CARRY',
    instructions:
      'Carry a single weight in one hand and walk without letting your torso tip towards it. The whole point is the side of your midsection resisting the lean, so a moderate weight you can stay upright with beats a heavy one you cannot. Walk the same distance on both sides.',
    contraindicationTags: ['lower_back'],
    substitutionGroup: 'carry',
  },

  // --------------------------------------------------------------------------- core
  {
    name: 'Plank',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'CORE',
    instructions:
      'Rest on your forearms and toes with your elbows under your shoulders and your body in one line from head to heels. Squeeze your glutes and pull your ribs down so your lower back does not sag. Hold for time and stop the set when the shape breaks, not when the clock says so.',
    contraindicationTags: ['lower_back', 'shoulder'],
    substitutionGroup: 'core',
  },
  {
    name: 'Side Plank',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'CORE',
    instructions:
      'Lie on your side, elbow under your shoulder, and lift your hips so your body is in one straight line. Keep your top hip stacked over the bottom one rather than rolling forward. Bending the bottom knee to the floor makes it easier. Hold for time on both sides.',
    contraindicationTags: ['shoulder'],
    substitutionGroup: 'core',
  },
  {
    name: 'Dead Bug',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'CORE',
    instructions:
      'Lie on your back with your arms straight up and your hips and knees bent to 90 degrees. Press your lower back gently into the floor and hold it there while you slowly lower one arm overhead and the opposite leg towards the floor. Return and switch sides. If your back lifts off the floor, shorten the range.',
    contraindicationTags: [],
    substitutionGroup: 'core',
  },
  {
    name: 'Cable Pallof Press',
    equipment: ['CABLE', 'BAND'],
    movementPattern: 'CORE',
    instructions:
      'Stand side-on to a cable or anchored band set at chest height, holding the handle with both hands at your sternum. Press it straight out in front of you and resist the pull that tries to rotate you, then bring it back in. Stand further from the anchor for more of a challenge.',
    contraindicationTags: [],
    substitutionGroup: 'core',
  },
  {
    name: 'Hanging Knee Raise',
    equipment: ['BODYWEIGHT'],
    movementPattern: 'CORE',
    instructions:
      'Hang from a bar with your shoulders pulled down away from your ears. Without swinging, curl your knees up towards your chest so your pelvis tucks slightly at the top, then lower slowly. If you swing, pause at the bottom of every rep until you can start each one from a dead hang.',
    contraindicationTags: ['shoulder', 'lower_back', 'overhead'],
    substitutionGroup: 'core',
  },

  // --------------------------------------------------------------------------- arms
  {
    name: 'Triceps Pressdown',
    equipment: ['CABLE', 'BAND'],
    movementPattern: 'ACCESSORY',
    instructions:
      'Stand facing a high cable or anchored band with your elbows pinned to your sides. Straighten your arms to push the handle down, pause briefly, and let it return until your forearms are just past parallel to the floor. Only the elbows move — if your shoulders start helping, drop the weight.',
    contraindicationTags: ['elbow'],
    substitutionGroup: 'arms',
  },
  {
    name: 'Dumbbell Overhead Triceps Extension',
    equipment: ['DUMBBELL'],
    movementPattern: 'ACCESSORY',
    instructions:
      'Hold one dumbbell overhead with both hands, elbows pointing forward and close to your head. Lower it behind your head until you feel a stretch along the back of your arms, then press back to straight. Keep your ribs down instead of arching your back to get the range.',
    contraindicationTags: ['elbow', 'shoulder', 'overhead'],
    substitutionGroup: 'arms',
  },
  {
    name: 'Dumbbell Curl',
    equipment: ['DUMBBELL'],
    movementPattern: 'ACCESSORY',
    instructions:
      'Stand with a dumbbell in each hand, arms straight and elbows close to your sides. Curl the weight up by bending the elbow only, pause at the top, and lower all the way under control. Do not swing your torso or let your elbows drift forward to finish the rep.',
    contraindicationTags: ['elbow'],
    substitutionGroup: 'arms',
  },
  {
    name: 'Band Curl',
    equipment: ['BAND'],
    movementPattern: 'ACCESSORY',
    instructions:
      'Stand on the middle of a band with a handle or end in each hand. Curl up against the band, keeping your elbows at your sides, and lower slowly against the tension rather than letting it pull your arms down. Widen your stance on the band for more resistance.',
    contraindicationTags: ['elbow'],
    substitutionGroup: 'arms',
  },
];

/**
 * Upserts the catalog on `(scope, nameKey)`, which is what makes re-running the
 * seed a no-op rather than 44 more rows.
 *
 * Deliberately does NOT touch `isCustom`/`scope` on update: a row a user
 * created that happens to collide with a catalog name lives under their own
 * scope, so it is never the row this touches.
 */
export async function seedExercises(client: PrismaClient): Promise<number> {
  console.log('Seeding exercise catalog...');

  for (const exercise of EXERCISES) {
    const nameKey = exerciseNameKey(exercise.name);
    await client.exercise.upsert({
      where: { scope_nameKey: { scope: 'catalog', nameKey } },
      update: {
        name: exercise.name,
        equipment: exercise.equipment,
        movementPattern: exercise.movementPattern,
        instructions: exercise.instructions,
        contraindicationTags: [...exercise.contraindicationTags],
        substitutionGroup: exercise.substitutionGroup,
      },
      create: {
        name: exercise.name,
        nameKey,
        scope: 'catalog',
        equipment: exercise.equipment,
        movementPattern: exercise.movementPattern,
        instructions: exercise.instructions,
        contraindicationTags: [...exercise.contraindicationTags],
        substitutionGroup: exercise.substitutionGroup,
        isCustom: false,
      },
    });
  }

  console.log(`✓ Seeded ${EXERCISES.length} exercises`);
  return EXERCISES.length;
}
