local hp = UnitHealth("target")
local max = UnitHealthMax("target")
if not issecretvalue(hp) and not issecretvalue(max) then
	local pct = hp / max * 100
	if hp < max then frame:Show() end
end
frame.text:SetText(string.format("%s hp", hp))
