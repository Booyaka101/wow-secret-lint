-- One site per rule, used to prove each rule fires and reports the right id.
local frame = CreateFrame("Frame")

local function CheckAll(unit)
	local hp = UnitHealth(unit)                       -- SecretReturns, number
	local inRange = UnitInRange(unit)                 -- SecretReturns, bool
	local casting = UnitCastingDuration(unit)         -- SecretReturns, LuaDurationObject

	local sum = hp + 1                                -- WSL001
	local cmp = hp > 10                               -- WSL002
	casting()                                         -- WSL003
	local len = #hp                                   -- WSL004
	local field = hp.value                            -- WSL005
	C_CVar.SetCVar("nameplateShowAll", hp)            -- WSL006 (NotAllowed)
	if inRange then                                   -- WSL007 (documented bool)
		frame:Show()
	end
	frame:RegisterEvent("COMBAT_LOG_EVENT")           -- WSL008
	local s = tostring(hp)                            -- WSL011
	return sum, cmp, len, field, s
end

return CheckAll
