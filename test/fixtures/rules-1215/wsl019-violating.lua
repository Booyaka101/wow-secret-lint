-- QueryAnimationProgress: querying a Pandemic-registered animation group or its animations.
local button = CreateFrame("AuraButton", nil, UIParent)
local group = button:CreateAnimationGroup()
local fade = group:CreateAnimation("Alpha")
button:AddPandemicEnterAnimation(group)

if group:IsPlaying() then group:Stop() end
local progress = group:GetProgress()
local elapsed = group:GetElapsed()
if group:IsPaused() or group:IsDone() then return end
if fade:IsDelaying() then return end
local smooth = fade:GetSmoothProgress()
print(progress, elapsed, smooth)
