package com.smhrd.myapp.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;

// 해당 클래스를 DB 테이블처럼 구성하겠다라고 명시
@Entity
@Data
@AllArgsConstructor
@NoArgsConstructor
@RequiredArgsConstructor
public class MemberEntity {

	// 이 클래스에 있는 필드는 테이블의 컬럼처럼 만들것임!!
	
	// 필수사항 -> 반드시 PK컬럼이 존재해야 함
	@Id // 이 컬럼은 PK값임을 명시하는 어노테이션
	@GeneratedValue(strategy = GenerationType.IDENTITY) // 시퀀스 번호
	private Long idx; // 각 회원을 식별할 고유한 값
	
	@NonNull
	@Column(nullable = false)
	private String email; // 이메일
	
	@NonNull
	@Column(length = 100)
	private String pw; // 비밀번호
	
	private String tel; // 전화번호
	
	private String address; // 집주소
	
	
	
	
}
