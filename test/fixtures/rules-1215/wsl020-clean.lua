-- Everything here happens before the group is registered, which is the documented order.
local button = CreateFrame("AuraButton", nil, UIParent)
local group = button:CreateAnimationGroup()
local fade = group:CreateAnimation("Alpha")
fade:SetDuration(0.5)

local spare = UIParent:CreateAnimationGroup()
local moved = spare:CreateAnimation("Scale")
moved:SetParent(spare)

button:AddPandemicLeaveAnimation(group)
