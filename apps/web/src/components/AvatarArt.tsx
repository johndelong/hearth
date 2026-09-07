/**
 * The built-in avatar pack.
 *
 * Each face is a small (256×256) transparent WebP under `/avatars`, self-hosted
 * like the app's font — no network dependency, and no per-render cost beyond
 * an <img> tag. The art sits on the person's own colour (passed as `ground`),
 * the same way the pack's original hand-drawn faces did, so the set still
 * reads as one coordinated thing and a glance still says whose face it is.
 */

import { AVATAR_PACK, type AvatarKey } from '@dashboard/shared';
import { TapButton } from './ui';
import { col } from '../theme';

export { AVATAR_PACK, type AvatarKey, isAvatarKey } from '@dashboard/shared';

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

/** A 52px avatar choice tile — selected reads as a ring in the person's colour. */
function avatarChoiceStyle(on: boolean, hue: number, night: boolean) {
  return {
    width: 52,
    height: 52,
    padding: 0,
    borderRadius: '50%',
    overflow: 'hidden',
    background: 'var(--chip)',
    boxShadow: on ? `0 0 0 3px ${col(hue, night)}` : 'inset 0 0 0 1px var(--line)',
  } as const;
}

/**
 * The whole "pick a face" grid, shared by the parent-only person editor and
 * the unprotected avatar picker on a kid's own profile — picking a face is
 * never a parent-gated action, so this carries no PIN logic of its own.
 */
export function AvatarPicker({
  value,
  name,
  hue,
  night,
  onChange,
}: {
  value: AvatarKey | null;
  name: string;
  hue: number;
  night: boolean;
  onChange: (key: AvatarKey | null) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {/* Off first, so clearing a choice is where you'd reach for it. */}
      <TapButton
        title="No avatar"
        onClick={() => onChange(null)}
        style={{
          ...avatarChoiceStyle(value === null, hue, night),
          display: 'grid',
          placeItems: 'center',
          fontSize: 19,
          fontWeight: 800,
          color: 'var(--ink2)',
        }}
      >
        {(name || '?').trim().charAt(0).toUpperCase()}
      </TapButton>

      {AVATAR_PACK.map((key) => (
        <TapButton
          key={key}
          title={avatarLabel(key)}
          onClick={() => onChange(key)}
          style={avatarChoiceStyle(value === key, hue, night)}
        >
          <AvatarArt id={key} size={52} ground={col(hue, night)} />
        </TapButton>
      ))}
    </div>
  );
}
