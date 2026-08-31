-- WSL012: every forbidden shape on a secret aura vector.
local auras = C_UnitAuras.GetUnitAuras("player")
local count = #auras                              -- length
for i = 1, 3 do
	local a = auras[i]                            -- numeric indexing
	print(a)
end
for _, aura in ipairs(auras) do                   -- ipairs iteration
	print(aura)
end
for k in pairs(auras) do                          -- pairs iteration
	print(k)
end
local seen = {}
local ids = C_UnitAuras.GetUnitAuraInstanceIDs("player")
seen[ids] = true                                  -- secret used as a table key
local copy = auras
local n = #copy                                   -- reassignment through a local stays tainted
