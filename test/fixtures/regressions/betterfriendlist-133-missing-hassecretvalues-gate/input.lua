-- Shape reconstructed from Hayato2846/BetterFriendlist#133 (ItalistAddons, 2026-08-23):
--   "InstallGuildMOTDChatHooks is missing the HasSecretValues gate used by its sibling
--    chat-pipeline hooks (12.x)". One member of an otherwise-gated family hands a value
--    straight into Blizzard's chat pipeline with no guard.
local BetterFriendlist = {}

-- Gated sibling: the guard is present, so this one is silent.
local function CacheChannelNameFromChatFrame(channelName)
	if issecretvalue(channelName) then
		return
	end
	ChatHistory_GetAccessID(channelName)
end

-- Ungated: the value crosses into Blizzard's chat pipeline with no guard.
local function CacheGuildMOTDFromChatFrame(motdText)
	ChatHistory_GetToken(motdText)
end

function BetterFriendlist:InstallGuildMOTDChatHooks(unit)
	local speaker = UnitSpellTargetName(unit)
	CacheChannelNameFromChatFrame(speaker)
	CacheGuildMOTDFromChatFrame(speaker)
end

return BetterFriendlist
