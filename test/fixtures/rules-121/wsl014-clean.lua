-- WSL014 negative: the replacements, plus feature detection by reference.
LoadAddOnWithErrorHandling("Blizzard_TrainerUI")
if PlayerFrame:CanBeAccessedInContext() then
	print("ok")
end
if UIParentLoadAddOn then                         -- referencing without calling is how you feature-detect
	print("old client")
end
local container = CreateFrame("AuraContainer", nil, UIParent, "CustomAuraContainerTemplate")
local plain = CreateFrame("Frame", nil, nil, "BackdropTemplate")
