/**
 * The built-in avatar pack.
 *
 * Each face is a small (256×256) transparent WebP under `/avatars`, self-hosted
 * like the app's font — no network dependency, and no per-render cost beyond
 * an <img> tag. The art sits on the person's own colour (passed as `ground`),
 * the same way the pack's original hand-drawn faces did, so the set still
 * reads as one coordinated thing and a glance still says whose face it is.
 */

export const AVATAR_PACK = [
  'axolotl',
  'bat',
  'bee',
  'bluebird',
  'cat',
  'chick',
  'chicken',
  'cow',
  'crab',
  'dino',
  'dog',
  'elephant',
  'fox',
  'frog',
  'garden-snail',
  'giraffe',
  'hamster',
  'hatchling',
  'hedgehog',
  'jellyfish',
  'koala',
  'lamb',
  'llama',
  'narwhal',
  'newt',
  'octopus',
  'panda',
  'panda-cub',
  'penguin',
  'pig',
  'platypus',
  'seal',
  'sheep',
  'sloth',
  'snail',
  'turtle',
] as const;

export type AvatarKey = (typeof AVATAR_PACK)[number];

export function isAvatarKey(value: unknown): value is AvatarKey {
  return typeof value === 'string' && (AVATAR_PACK as readonly string[]).includes(value);
}

const LABEL: Record<AvatarKey, string> = {
  axolotl: 'Axolotl',
  bat: 'Bat',
  bee: 'Bee',
  bluebird: 'Bluebird',
  cat: 'Cat',
  chick: 'Chick',
  chicken: 'Chicken',
  cow: 'Cow',
  crab: 'Crab',
  dino: 'Dino',
  dog: 'Dog',
  elephant: 'Elephant',
  fox: 'Fox',
  frog: 'Frog',
  'garden-snail': 'Garden Snail',
  giraffe: 'Giraffe',
  hamster: 'Hamster',
  hatchling: 'Hatchling',
  hedgehog: 'Hedgehog',
  jellyfish: 'Jellyfish',
  koala: 'Koala',
  lamb: 'Lamb',
  llama: 'Llama',
  narwhal: 'Narwhal',
  newt: 'Newt',
  octopus: 'Octopus',
  panda: 'Panda',
  'panda-cub': 'Panda Cub',
  penguin: 'Penguin',
  pig: 'Pig',
  platypus: 'Platypus',
  seal: 'Seal',
  sheep: 'Sheep',
  sloth: 'Sloth',
  snail: 'Snail',
  turtle: 'Turtle',
};

export const avatarLabel = (id: AvatarKey): string => LABEL[id];

export function AvatarArt({
  id,
  size,
  ground,
}: {
  id: AvatarKey;
  size: number;
  /** Defaults to a neutral chip colour; callers pass the person's colour. */
  ground?: string;
}) {
  return (
    <div
      role="img"
      aria-label={LABEL[id]}
      style={{
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        background: ground ?? '#eceef2',
        overflow: 'hidden',
      }}
    >
      <img
        src={`/avatars/${id}.webp`}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        style={{ width: '84%', height: '84%', objectFit: 'contain', display: 'block' }}
      />
    </div>
  );
}
