-- WSL018 negative: by-spell lookups are not index/slot/instance reads, and the
-- AuraContainer path replaces the scan entirely.
local container = CreateFrame("AuraContainer", nil, UIParent, "CustomAuraContainerTemplate")
container:AddAuraGroup("buffs", "HELPFUL", { maxFrameCount = 8 })

local aura = C_UnitAuras.GetPlayerAuraBySpellID(774)
if not aura or issecretvalue(aura.name) then
	return
end
print(aura.icon)
