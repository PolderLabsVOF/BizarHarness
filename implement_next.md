there were issues with the cline config that caused cline to not start. i fixed them now by removing the incompatible stuff. check what changed and make sure you dont mess up the config with incompatible keys and values and stuff.

make sure you dont store any api keys or sensitive stuff like that in plaintext configs. alswya use env variables. create special env variables for bizar that i can manage in the settings in the dash. when configuring an llm or provider or whatever i should be able to choose a configured env var or create a new one. 

next:
- overhaul the settings page to function better and easier.
- add extended usage monitoring and analytics to the usage page with tracking of tokens, requests etc. with configurable time ranges and nice visual and interactive graphs. 
- add backup provider keys config to the config page. add it in providers so i can add a second key to the provider that will be used when the first key is donw or out of tokens or something like that.
- make lightrag default to free cline models. 
- make adding providers in the config tab easier with filled in defaults so i can search for a provider and only input the key. so i odnt have to type everything myself. 
- improve the general ui of the config page. 
- add memory settings to the settings tab to configure things for the lightrag+obsidian memory system and things like configuring the git repo for it. 
- i cant open an cline session in the dash chat. 
- fix and improve the updating in settings of bizar.
- do an overal consistency ui pass on each page, some pages things like pading and margins are a bit messed up.
- i cant see the bizar skils in the skills tab.
- update and improve the whole bizar skills toolset with everything new and make sure its solid. 
- when sea4rching for skills the output is messed up, looks like terminal ascii logo is beijng put in tthe titles or something. 
- remove agent selection from task creation and simplify it. you only have to create a task and then odin decides what to do with it and what priority it is etc.
- i also cant create a new session in the chat tab.
- do a full overhaul of the chat functinality and how it works. it needs to work smooth and perfect. make sure its well integrated with cline.
- add a function so agents can knwo the usage limits so they can be aware of it while they work. 
- merge the config page into the settings page.
- restructure the settings page to not have as many seperate menus and studff and make sure its easy to navigate and finsd things. 
- make sure the search function in the dash also works for settings. so i can find individual settings. 

create full release when everything is implemented and validated.