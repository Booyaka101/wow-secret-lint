-- WSL014: every symbol 12.1 removed or renamed.
UIParentLoadAddOn("Blizzard_TrainerUI")
if CanAccessObject(PlayerFrame) then
	print("ok")
end
C_UnitAuras.TriggerPrivateAuraShowDispelType(1)
local header = CreateFrame("Frame", "MyAuras", UIParent, "SecureAuraHeaderTemplate")
local combo = CreateFrame("Button", nil, nil, "SecureAuraHeaderTemplate,BackdropTemplate")
