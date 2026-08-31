-- WSL016: the removed showCountdownFrame field, inline and through a local.
C_UnitAuras.AddPrivateAuraAnchor({
	unitToken = "player",
	auraIndex = 1,
	parent = UIParent,
	showCountdownFrame = true,
})

local args = {
	unitToken = "player",
	auraIndex = 2,
	parent = UIParent,
}
args.showCountdownFrame = true
C_UnitAuras.AddPrivateAuraAnchor(args)
