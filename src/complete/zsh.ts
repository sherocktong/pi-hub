import { PI_PROVIDERS } from "../types.js";

export const ZSH_COMPLETION = `#compdef pi-hub

_pi-hub() {
  local -a commands
  commands=(
    'profile:Manage pi agent profiles'
    'use:Set a profile as the default'
    'run:Launch pi using the default or a specified profile'
    'completion:Print shell completion script'
    'help:Display help for a command'
  )

  local -a profile_subcmds
  profile_subcmds=(
    'add:Add or update a profile'
    'update:Update fields of an existing profile'
    'list:List all profiles'
    'view:View full details of a profile'
    'remove:Remove a profile'
    'rename:Rename a profile'
    'default:Set the default profile'
  )

  _pi_hub_profiles() {
    local profiles_file="\${PI_HUB_PROFILES_FILE:-\$HOME/.pi/profiles.json}"
    if [[ -f "$profiles_file" ]]; then
      local -a names
      names=(\${(f)"$(command jq -r '.profiles | keys[]' "$profiles_file" 2>/dev/null)"})
      _describe -t profiles 'profile' names
    fi
  }

  _pi_hub_models_for_profile() {
    local profile_name="$1"
    local profiles_file="\${PI_HUB_PROFILES_FILE:-\$HOME/.pi/profiles.json}"
    if [[ -f "$profiles_file" && -n "$profile_name" ]]; then
      local -a models
      models=(\${(f)"$(command jq -r --arg p "$profile_name" '(.profiles[$p].models // [ .profiles[$p].model ] )[]? // empty' "$profiles_file" 2>/dev/null)"})
      _describe -t models 'model' models
    fi
  }

  _arguments -C \\
    '1: :->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe -t commands 'pi-hub command' commands
      ;;
    args)
      case $words[1] in
        profile)
          if (( CURRENT == 2 )); then
            _describe -t profile-subcmds 'profile subcommand' profile_subcmds
          elif [[ $words[2] == "view" || $words[2] == "remove" ]]; then
            _pi_hub_profiles
          elif [[ $words[2] == "default" ]]; then
            _arguments -C -S \\
              '--built-in[Use your existing pi config as default (no profile)]' \\
              '*:profile:_pi_hub_profiles'
          elif [[ $words[2] == "rename" ]]; then
            if (( CURRENT == 3 )); then
              _pi_hub_profiles
            fi
          elif [[ $words[2] == "add" ]]; then
            if (( CURRENT == 3 )); then
              # profile name is free text; nothing to complete
              return 1
            else
              words=("stub" $words[3,-1])
              (( CURRENT-- ))
              _arguments -C -S \\
                '1:profile:' \\
                '(-m --model)*'{-m,--model}'[Model ID]:model:' \\
                '(-t --token)'{-t,--token}'[API key / token]:token:' \\
                '(-u --url)'{-u,--url}'[Base URL]:url:' \\
                '(-p --provider)'{-p,--provider}'[pi provider id]:provider:(${PI_PROVIDERS.join(" ")})' \\
                '--thinking[Thinking level]:level:(off minimal low medium high xhigh max)'
            fi
          elif [[ $words[2] == "update" ]]; then
            if (( CURRENT == 3 )); then
              _pi_hub_profiles
            else
              words=("stub" $words[3,-1])
              (( CURRENT-- ))
              _arguments -C -S \\
                '1:profile:_pi_hub_profiles' \\
                '(-m --model)*'{-m,--model}'[Model ID]:model:->profileModel' \\
                '(-d --delete-model)*'{-d,--delete-model}'[Remove model ID]:model:->profileModel' \\
                '(-t --token)'{-t,--token}'[API key / token]:token:' \\
                '(-u --url)'{-u,--url}'[Base URL]:url:' \\
                '(-p --provider)'{-p,--provider}'[pi provider id]:provider:(${PI_PROVIDERS.join(" ")})' \\
                '--thinking[Thinking level]:level:(off minimal low medium high xhigh max)'
              case $state in
                profileModel)
                  _pi_hub_models_for_profile $line[1]
                  ;;
              esac
            fi
          fi
          ;;
        use|run)
          _arguments -C -S \\
            '--built-in[Use your existing pi config (no profile)]' \\
            '*:profile:_pi_hub_profiles'
          ;;
      esac
      ;;
  esac
}

compdef _pi-hub pi-hub
`;
