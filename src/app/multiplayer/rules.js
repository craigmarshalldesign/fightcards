const DEFAULT_RULE_KEY = 'visibility';
const DEFAULT_RULE_VALUE = 'public';

const envRuleKey = import.meta.env.VITE_INSTANTDB_MULTIPLAYER_RULE_KEY;
const envRuleValue = import.meta.env.VITE_INSTANTDB_MULTIPLAYER_RULE_VALUE;

const resolvedRuleKey = typeof envRuleKey === 'string' && envRuleKey.trim()
  ? envRuleKey.trim()
  : DEFAULT_RULE_KEY;

const resolvedRuleValue = typeof envRuleValue === 'string' && envRuleValue.trim()
  ? envRuleValue.trim()
  : DEFAULT_RULE_VALUE;

export const MULTIPLAYER_RULE_PARAMS = Object.freeze({
  [resolvedRuleKey]: resolvedRuleValue,
});

export function applyMultiplayerRuleParams(chunk) {
  if (!chunk || typeof chunk.ruleParams !== 'function') {
    return chunk;
  }
  return chunk.ruleParams(MULTIPLAYER_RULE_PARAMS);
}

