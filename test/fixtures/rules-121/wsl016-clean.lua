-- WSL016 negative: the 12.1 field names.
C_UnitAuras.AddPrivateAuraAnchor({
	unitToken = "player",
	auraIndex = 1,
	parent = UIParent,
	showCooldownFrame = true,
	showCooldownEdge = true,
	showDispelIcon = true,
})
local options = { showCountdownFrame = true }     -- never passed to a private-aura API
print(options)
