-- Shape reconstructed from lucascodev/aura-questor#68 (reesesm2000, 2026-08-23, game 12.10):
--   "Blizzard_UIWidgetTemplateTextWithState.lua:35: attempt to perform arithmetic on local
--    'textHeight' (a secret number value, while execution tainted by 'AuraQuestor')"
-- Independent repo, identical signature. Multi-return assignment where only one position
-- carries the secret.
local AuraQuestor = {}

function AuraQuestor:LayoutQuestWidget(frame, unit)
	local inRange, checkedRange = UnitInRange(unit)
	local textHeight = UnitGetTotalHealAbsorbs(unit)
	frame:SetHeight(textHeight / 2)
	return checkedRange
end

return AuraQuestor
