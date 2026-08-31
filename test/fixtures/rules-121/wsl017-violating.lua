-- WSL017: forbidden-aspect operations on AuraContainers and AuraButtons.
local container = CreateFrame("AuraContainer", nil, UIParent, "CustomAuraContainerTemplate")
container:RegisterEvent("PLAYER_ENTERING_WORLD")          -- EventRegistrations
container:RegisterUnitEvent("UNIT_AURA", "player")        -- EventRegistrations
container:AddAuraGroup("buffs", "HELPFUL", {
	maxFrameCount = 16,
	initializeFrame = function(button)
		button:SetScript("OnShow", function() end)        -- UntrustedScriptExecution
		button:HookScript("OnHide", function() end)       -- UntrustedScriptExecution
		button:RegisterEvent("UNIT_AURA")                 -- EventRegistrations
		button:EnableMouse(true)                          -- ScriptedInput
		button:RegisterForClicks("RightButtonUp")         -- ScriptedInput
		if button:IsMouseOver() then                      -- QueryFocus
			print("hover")
		end
	end,
})
local btn = CreateFrame("AuraButton", nil, container, "CustomAuraButtonTemplate")
btn:SetScript("OnEnter", function() end)                  -- UntrustedScriptExecution
