-- WSL013: forbidden operations on the unit identity APIs 12.1 made secret.
local localizedClass, classFile, classID = UnitClass("target")
if classFile == "MAGE" then                       -- comparison
	print("sheep it")
end
local nextID = classID + 1                        -- arithmetic on a later return position
local base = UnitClassBase("target")
local key = {}
key[base] = true                                  -- table key
local race = UnitRace("target")
if race ~= "Gnome" then
	print("tall enough")
end
local sex = UnitSex("target") * 2                 -- arithmetic
if UnitIsCharmed("target") then                   -- boolean test, documented bool
	print("charmed")
end
if UnitIsPossessed("target") then                 -- boolean test, documented bool
	print("possessed")
end
local kind = UnitSexBase("target")
local copy = kind
local flipped = copy == 2                         -- reassignment through a local stays tainted
