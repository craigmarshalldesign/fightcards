let passiveHandler = () => {};

export function registerPassiveHandler(handler) {
  passiveHandler = handler;
}

export function triggerAttackPassive(creature, controllerIndex) {
  passiveHandler(creature, controllerIndex, 'onAttack');
}
