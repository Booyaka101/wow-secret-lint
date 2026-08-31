-- WSL012 negative: everything here is permitted on an aura vector.
local auras = C_UnitAuras.GetUnitAuras("player")
local stash = auras                               -- storing is allowed
local t = { auras = auras }                       -- table value is allowed
if auras then                                     -- boolean test on a non-boolean secret
	print("got auras")
end
print(string.format("%s", auras))                 -- sanctioned render path
local label = "auras: " .. tostring               -- concat of non-secrets
if not issecretvalue(auras) then
	local n = #auras                              -- guarded, taint cleared
	print(n)
end
