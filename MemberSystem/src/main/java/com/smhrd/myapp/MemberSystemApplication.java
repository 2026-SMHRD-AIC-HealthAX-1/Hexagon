package com.smhrd.myapp;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// - 이 클래스의 위치를 기준으로 해서 하위의 파일들을 읽음
// - 이 클래스는 프로젝트 최상단 위치에 있어야 함
// - 이 클래스는 스프링 부트의 자동화 기능을 담당
@SpringBootApplication
public class MemberSystemApplication {

	// @SpringBootApplication : 3개의 어노테이션이 합쳐진 어노테이션
	
	// 1. @SpringBootConfiguration
	// - SpringBoot의 전반적인 환경설정을 담당
	
	// 2. @EnableAutoConfiguration
	// - 라이브러리 삽입 시 알아서 pom.xml파일에 작성
	// - 라이브러리가 있는 것 만으로도 bean객체를 생성해서 환경설정에 도움
	
	// 3. @CommponentScan
	// - controller를 사용하기 위해서 servlet-context에 scan bean 객체 생성
	
	public static void main(String[] args) {
		SpringApplication.run(MemberSystemApplication.class, args);
	}

}
