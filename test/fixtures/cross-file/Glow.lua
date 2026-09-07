local private = select(2, ...)

if private.group:IsPlaying() then private.group:Stop() end
private.group:CreateAnimation("Scale")
