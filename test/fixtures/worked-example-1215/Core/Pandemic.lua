local button = CreateFrame("AuraButton", nil, UIParent)
local glow = button:CreateTexture(nil, "OVERLAY")

local group = glow:CreateAnimationGroup()
local fade = group:CreateAnimation("Alpha")
fade:SetDuration(0.5)

button:AddPandemicActiveAnimation(group)

if group:IsPlaying() then group:Stop() end
group:CreateAnimation("Scale")
