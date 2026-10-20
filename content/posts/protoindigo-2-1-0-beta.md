---
id: protoindigo-2-1-0-beta
title: "ProtoIndigo 2.1.0-beta"
description: "ProtoIndigo 2.1.0-beta já está disponível! Bora conferir tudo o que essa versão está trazendo?"
date: "2026-10-19"
category: projects
banner: "images/posts/pit2.1.0-beta.png"
featured: true
draft: false
badges: []
tags: []
authors:
  - "@Victor Botelho A."
buttons: []
---

ProtoIndigo 2.1 beta já está disponível! Bora conferir tudo o que essa versão está trazendo?

Essa versão foca totalmente em refatoração, reforma na arquitetura, inovações, novas funcionalidades e mudanças na sintaxe. Além de colocar em foco seu novo sistema de **Embedding**.

Estou criando uma **Standard Library** para a linguagem **Bre** *(sim, o nome da linguagem será este)*, e, com ela, vieram duas novas formas de obter a versão da BreVM e do interpretador, através dos símbolos:

```bre
std_vm_version
std_version
```

Que são APIs simples, expostas pela classe `Operation`.

E estou trabalhando no novo sistema de módulos e bibliotecas nativas da linguagem, para ela poder se tornar mais útil em aplicações C++.

Vou deixar pra mostrar um pouco da API de bibliotecas pro final.

Além disso, as atualizações futuras da BreVM estão chegando para colaborar com as novas funcionalidades da linguagem:

## BreVM Groups

Como arrays, que também funcionam como objetos!

## BreVM NativeFunctions

Funções nativas expostas na BreVM.

E, com isso, eu acho que as funções e as funções nativas estão bem perto de chegar no ProtoIndigo.

**E depois vamos poder dizer adeus à instrução `proto` da linguagem!**

## Sintaxe ProtoIndigo

A sintaxe recebeu atualizações! Agora, a linguagem abandonou o antigo estilo para declaração de constantes:

```bre
new const x = 10;
```

E passa a aceitar somente:

```bre
now x = 10;
```

Escolhi essa sintaxe porque dá mais característica à linguagem e é bem menos verbosa que a versão antiga.

### Labels & Goto

**É REAL!** ProtoIndigo agora possui o primeiro sistema de controle de fluxo!

Agora, é possível marcar pontos específicos no código e redirecionar a execução da BreVM para exatamente o mesmo ponto, através de um identificador:

```bre
label casa
```

E voltar para aquele ponto específico com:

```bre
go to casa
```

Esse exemplo faz o código ficar rodando infinitamente. Por exemplo:

```bre
new #String _txt = "ProtoIndigo " + std_version;
label casa
proto _txt
go to casa
```

Aqui, a instrução `proto _txt` vai ser executada até que alguém encerre o programa.

### Expressões aritméticas

Também com foco nas expressões aritméticas, elas foram expandidas e melhoradas. Com expressões entre parênteses, incremento, decremento, multiplicação e precedência corrigida, a experiência com essas expressões mudou muito.

```bre
now x = 10 - (10 * 2);
now y = 2x;
```

Percebeu algo diferente? Pois é! Agora temos suporte para multiplicação implícita, que segue a seguinte sintaxe:

```bre
now x = 10 * (10 * 2);
now y = 2x;
now z = 2(10 / 2);
```

Que são equivalentes a:

```bre
now x = 10 * (10 * 2);
now y = 2 * x;
now z = 2 * (10 / 2);
```

E também temos instruções de incremento e decremento:

```bre
x++ // adiciona 1
x-- // remove 1
```

### Pre Instructions

Instruções de pré-execução são instruções que ocorrem antes da execução do código na VM. E a inclusão de arquivos entrou nessa categoria:

```bre
pre include "module.bre"
// Substituindo include "module.bre"
```

Calma, comentários? Pois é! Agora temos suporte a comentários na linguagem. O Tokenizer os ignora completamente e não os passa nem pro Parser.

Pretendo adicionar comentários de várias linhas mais tarde.

E essa é só a versão beta! ProtoIndigo 2.1 vai trazer muitas novidades.

Estive pensando na seguinte API para embedding e criação de libs nativas:

```cpp
#include <indigo.h>
#include <brevm.h>
#include <iostream>

void print(brevm::String conteudo)
{
    std::cout << conteudo << std::endl;
}

int main()
{
    indigo::Operation O;
    indigo::Lib lib("MinhaLib");

    lib.symbol("print", brevm::NativeFunction(print));

    O.installLibrary(lib); // Instala a lib no Operation

    O.loadString("print('HelloWorld!')");
}
```

Planejo fazer com que as NativeFunctions sejam capazes de obter e se adaptar aos tipos e parâmetros das funções.

*Essa API não existe ainda, então não será compilada atualmente*.
