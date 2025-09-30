import { state } from '../state.js';

// Dynamic AI loader - switches between easy and hard AI based on difficulty setting
// We use dynamic import to load the correct AI module based on difficulty

// Import both AI modules statically to avoid async issues
import * as hardAI from './ai.js';
import * as easyAI from './ai-easy.js';

function getAI() {
  const difficulty = state.ui.aiDifficulty || 'easy';
  return difficulty === 'easy' ? easyAI : hardAI;
}

// Re-export all AI functions, routing to the correct module based on difficulty
export function runAI() {
  const ai = getAI();
  return ai.runAI();
}

export function registerAIHelpers(api) {
  // Register helpers for both AI modules to ensure they're always ready
  easyAI.registerAIHelpers(api);
  hardAI.registerAIHelpers(api);
}

export function assignAIBlocks() {
  const ai = getAI();
  // Both AIs have blocking logic - Easy blocks everything, Hard is strategic
  if (ai.assignAIBlocks) {
    return ai.assignAIBlocks();
  }
}
