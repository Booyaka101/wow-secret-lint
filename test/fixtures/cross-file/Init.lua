local ADDON_NAME, ns = ...

ns.container = CreateFrame("AuraContainer", nil, UIParent, "CustomAuraContainerTemplate")
CrossFileGlowButton = CreateFrame("AuraButton", nil, UIParent)
ns.group = CrossFileGlowButton:CreateAnimationGroup()
_G["CrossFileSpare"] = CreateFrame("AuraButton", nil, UIParent)
