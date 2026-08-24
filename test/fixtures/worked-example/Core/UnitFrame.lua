local hp = UnitHealth("target")
local max = UnitHealthMax("target")
local pct = hp / max * 100
if hp < max then frame:Show() end
frame.text:SetText(string.format("%s hp", hp))
