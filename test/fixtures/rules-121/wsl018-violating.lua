-- WSL018: the call itself errors while auras are secret, guard or no guard.
local slots = C_UnitAuras.GetAuraSlots("player", "HELPFUL")
local byIndex = C_UnitAuras.GetAuraDataByIndex("player", 1)
local bySlot = C_UnitAuras.GetAuraDataBySlot("player", 1)
local byInstance = C_UnitAuras.GetAuraDataByAuraInstanceID("player", 7)
local buff = C_UnitAuras.GetBuffDataByIndex("player", 1, "HELPFUL")
local debuff = C_UnitAuras.GetDebuffDataByIndex("player", 1, "HARMFUL")
local tip = C_TooltipInfo.GetUnitBuff("player", 1)

-- Correctly guarding the result does not help: the call above already errored.
local aura = C_UnitAuras.GetAuraDataByIndex("target", 2)
if not aura or issecretvalue(aura.name) then
	return
end
print(aura.icon)
