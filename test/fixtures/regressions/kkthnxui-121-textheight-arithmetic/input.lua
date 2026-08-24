-- Shape reconstructed from Kkthnx-Wow/KkthnxUI#121 (CDNDream, 2026-08-23):
--   "attempt to perform arithmetic on local 'textHeight' (a secret number value,
--    while execution tainted by 'KkthnxUI')"
--   Blizzard_UIWidgetTemplateTextWithState.lua:35, in function 'Setup'
-- The addon feeds a secret number into a widget layout calculation.
local K = select(2, ...)

function K:SetupTextWithState(widgetFrame, unit)
	local textHeight = UnitHealthPercent(unit)
	widgetFrame.Text:SetHeight(textHeight + 8)
	widgetFrame:SetHeight(textHeight * 2)
end
