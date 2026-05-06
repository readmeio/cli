export const command = 'play';
export const description = 'Visit your pet';
export const hidden = true;
export const skipBootstrap = true;
export const order = 99;
export const category = 'Other';

export async function run(variant) {
  if (variant === 'reset') {
    const { resetPet } = await import('../utils/tamagotchi.js');
    resetPet();
    return;
  }

  const { startGame } = await import('../utils/tamagotchi.js');
  await startGame();
}
