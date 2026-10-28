# CamVR

Protótipo Windows que rastreia rosto/cabeça e as duas mãos pela webcam, e publica um HMD e dois controles virtuais por meio de um driver SteamVR/OpenVR. A pinça entre polegar e indicador da mão direita aciona o gatilho.

> **Aviso de segurança:** houve um relato de artefatos gráficos persistentes ao ativar este HMD experimental no SteamVR. O driver foi desregistrado e o instalador agora bloqueia o registro por padrão. Não tente ativá-lo novamente até que o problema seja investigado em uma máquina de teste.

## O que este protótipo faz (e não faz)

- A janela do app mostra a câmera, os pontos das mãos, o estado do rastreamento e os controles para ligar/desligar o envio ao SteamVR.
- O driver registra três dispositivos OpenVR e recebe poses/gestos localmente por UDP em `127.0.0.1:26760`.
- A posição da cabeça é aproximada usando uma única webcam; não é rastreamento 6DoF calibrado. A qualidade depende de iluminação, enquadramento, câmera e desempenho do computador.
- O HMD virtual não é um headset físico nem garante uma imagem confortável ou segura. Não use para locomoção; teste sentado e pare se sentir desconforto.
- O app envia dispositivos ao SteamVR, mas isso não garante suporte no cliente Roblox instalado. Roblox e cada jogo precisam aceitar VR/controles do runtime; a compatibilidade deve ser testada localmente.

Os modelos do MediaPipe e o runtime WebAssembly são carregados da internet na primeira inicialização.

## Requisitos

- Windows 10/11 x64.
- Node.js 22.12+ e npm.
- Steam e SteamVR instalados.
- Visual Studio 2022 com a carga de trabalho **Desenvolvimento para desktop com C++**, CMake e Git for Windows (usado para baixar o SDK OpenVR na primeira compilação).
- Webcam frontal funcional.

## Rodar o app

Na pasta do projeto:

```powershell
npm.cmd install
npm.cmd start
```

Clique em **Permitir e conectar câmera** e aceite a solicitação do Windows. Depois de conectar, escolha a webcam ou **DroidCam** em **Fonte de vídeo**. O app mostra os pontos e as conexões das mãos e o contorno rastreado do rosto. Espere encontrar o rosto e as duas mãos; pressione **Recentralizar** olhando para a câmera e, quando estiver pronto, **Ligar VR**.

### Usar um celular com DroidCam

1. Instale e abra o DroidCam no celular e o cliente do DroidCam no PC.
2. Conecte o celular ao PC pelo método configurado no DroidCam (Wi-Fi ou USB) e inicie o vídeo no cliente do PC.
3. No Windows, confira **Configurações > Privacidade e segurança > Câmera** e ative o acesso à câmera e o acesso para aplicativos da área de trabalho.
4. Abra o CamVR, clique em **Permitir e conectar câmera** e selecione **DroidCam** em **Fonte de vídeo**. Se ele não aparecer, confira se o vídeo está ativo no cliente do PC e use **Tentar novamente**.

Se o acesso já foi negado, feche e abra o CamVR de novo depois de alterar a permissão do Windows. Feche outros programas que possam estar usando a câmera.

O processamento das mãos e do rosto roda em um worker separado da interface, em resolução reduzida de 320 x 240 e até 8 análises por segundo para aliviar o processador. A imagem da câmera pode continuar em uma resolução maior. O app mantém o processamento ativo em segundo plano enquanto o SteamVR Home está em primeiro plano. Se uma mão sair do enquadramento, a última pose válida continua sendo enviada ao SteamVR até a mão voltar; o gatilho e a pinça são soltos enquanto a mão não estiver visível. Se a própria câmera interromper o vídeo por mais de alguns segundos, o app pausa o rastreamento; confira a webcam ou retome o vídeo no DroidCam e reconecte a câmera.

## Compilar e registrar o driver

Instale o **CMake**, o **Git for Windows** e o **Visual Studio 2022** (Community ou Build Tools) com a carga de trabalho **Desenvolvimento para desktop com C++**. O CMake instalado sozinho nao inclui o compilador C++. No Visual Studio Installer, escolha **Modificar** e marque essa carga, incluindo as ferramentas MSVC x64/x86 e CMake. Se precisar instalar CMake e Git pelo WinGet:

```powershell
winget install --id Kitware.CMake -e
winget install --id Git.Git -e
```

Depois da instalacao, feche e abra um novo terminal do VS Code para atualizar o `PATH`. Na pasta do projeto, compile primeiro:

```powershell
npm.cmd run build:driver
```

O registro do HMD está bloqueado por padrão porque a última versão experimental causou artefatos gráficos no SteamVR. **Não remova essa proteção para uso normal.** Uma tentativa experimental consciente exige fornecer explicitamente o parâmetro:

```powershell
npm.cmd run install:driver -- -EnableExperimentalHmdDisplay
```

Use-o somente numa máquina de teste, sabendo que ele pode voltar a afetar o compositor/gráficos do SteamVR. Se a compilacao indicar que falta `cmake` ou `git`, instale a ferramenta indicada e abra um novo terminal. Se o script nao encontrar o Visual Studio ou o compilador, abra o Visual Studio Installer, escolha **Modificar** e instale/complete a carga **Desenvolvimento para desktop com C++**. Aguarde cada compilacao terminar antes de iniciar outra: o script impede duas compilacoes simultaneas na mesma pasta. Nao tente registrar o driver novamente ate a falha grafica ser entendida.

O parâmetro `-SteamVrPath` só informa onde o SteamVR está instalado; ele não libera o registro. O instalador interrompe a execução por segurança antes de verificar o caminho, então tentar novamente com outro caminho não resolve esse bloqueio. Não contorne a proteção nem registre o HMD experimental enquanto a causa dos artefatos gráficos não for investigada.

Se o driver já estiver registrado, remova-o com `npm.cmd run uninstall:driver` e reinicie o SteamVR. Abra o CamVR sem registrar o driver para usar somente a câmera e o overlay local.

## Estado

Este é um primeiro protótipo de integração. O driver HMD encontra-se bloqueado para uso por causa do relato de artefatos gráficos. A causa precisa ser investigada e corrigida antes de voltar a testar a enumeração dos dispositivos no SteamVR ou o funcionamento no Roblox.
