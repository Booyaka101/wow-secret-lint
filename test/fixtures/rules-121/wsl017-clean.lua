-- WSL017 negative: construction and the supported customisation paths.
local container = CreateFrame("AuraContainer", nil, UIParent, "CustomAuraContainerTemplate")
container:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 10, -10)
container:SetSize(300, 40)
container:AddAuraGroup("buffs", "HELPFUL", {
	maxFrameCount = 16,
	initializeFrame = function(button)
		button:SetAuraBorder(button.Border)               -- supported customisation
		button:SetCancelAuraButtons("RightButton")        -- supported customisation
	end,
})
container:AddAuraSlot("precog", "HELPFUL", {})
local watcher = CreateFrame("Frame")
watcher:RegisterEvent("PLAYER_ENTERING_WORLD")            -- a plain frame may register events
watcher:SetScript("OnEvent", function() end)
