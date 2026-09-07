-- Blizzard's own sample from the 12.1.5 notes: build the group, then register it. Querying
-- a group that was never handed to a Pandemic trigger is unrestricted, and so is querying
-- an animation on a frame the addon owns.
local button = CreateFrame("AuraButton", nil, UIParent)
local glow = button:CreateTexture(nil, "OVERLAY")

local animGroup = glow:CreateAnimationGroup()
animGroup:SetLooping("BOUNCE")

local animAlpha = animGroup:CreateAnimation("Alpha")
animAlpha:SetFromAlpha(0)
animAlpha:SetToAlpha(1)
animAlpha:SetDuration(0.5)

local mine = UIParent:CreateAnimationGroup()
if mine:IsPlaying() then mine:Stop() end
local pulse = mine:CreateAnimation("Scale")
print(pulse:GetProgress(), mine:GetElapsed())

button:AddPandemicActiveAnimation(animGroup)
