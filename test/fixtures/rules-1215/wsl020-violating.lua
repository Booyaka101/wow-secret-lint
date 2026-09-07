-- AddAnimations: adding to, or reparenting onto, a Pandemic-registered animation group.
local button = CreateFrame("AuraButton", nil, UIParent)
local group = button:CreateAnimationGroup()
button:AddPandemicActiveAnimation(group)

local extra = group:CreateAnimation("Scale")
local other = UIParent:CreateAnimationGroup()
local loose = other:CreateAnimation("Alpha")
loose:SetParent(group)
print(extra, loose)
